#!/usr/bin/env python3
"""批量把 TIFF 照片转成 JPEG，并尽可能保住原始分辨率与色彩细节。

设计取舍（都是为了"少损失"）：

1. 绝不缩放。输出像素尺寸与源文件完全一致，脚本内没有任何 resize 逻辑。
2. 方向处理不重采样：EXIF Orientation 用无损的 90 度旋转烧进像素
   （Image.transpose），避免图片躺倒或被查看器二次拉伸。
3. 16 位灰度等高位深图像走显式缩放（round(value/257)，等价于 v*255/65535），
   因为 Pillow 的 convert("L") 对 I;16 会直接饱和（实测 10402 -> 255）。
4. 16 位 RGB 的 TIFF，Pillow 读取时只取高字节（静默丢精度）。
   脚本对"未压缩 / Deflate 压缩且无 predictor"的文件自行分条带解码原始 16 位样本，
   做精确的 16 -> 8 位缩放；确实无法精确处理时明确告警，不装作无事发生。
5. CMYK / LAB 等带内嵌 ICC 的文件，用 LittleCMS 转到 sRGB，
   比 im.convert("RGB") 的简易换算准确得多（实测单通道差异可达 34/255）。
6. JPEG 编码用高保真参数：quality 95、subsampling 0（4:4:4，色度不抽样，
   保住彩色边缘锐度）、optimize（无损 Huffman 优化；超出 Pillow 缓冲上限时自动回退）。
7. 保留 DPI、ICC 描述文件与有意义的 EXIF（相机、拍摄时间、作者、版权等），
   同时剔除会误导人的"像素布局类"标签（宽高、位深、条带偏移等）。

用法示例：

    python3 scripts/tiff2jpg.py ~/Pictures/tiff              # 就地生成同名 .jpg
    python3 scripts/tiff2jpg.py ~/Pictures/tiff -o ~/Pictures/jpg -r -j 4
    python3 scripts/tiff2jpg.py photo.tif -o out.jpg --quality 97
    python3 scripts/tiff2jpg.py in/ -o out/ --dry-run --report report.csv

依赖：Pillow（必需）、numpy（高位深图像需要；缺失时降级并告警）。
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import re
import sys
import time
import warnings
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

try:
    from PIL import Image, ImageCms
except ImportError:  # pragma: no cover
    sys.exit("缺少 Pillow，请先安装：python3 -m pip install --upgrade Pillow")

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

# 自己管理内存占用；--max-megapixels 会覆盖这个无限值。
Image.MAX_IMAGE_PIXELS = None
warnings.simplefilter("ignore", Image.DecompressionBombWarning)

DEFAULT_EXTENSIONS = ("tif", "tiff")

# TIFF 标签号（不依赖 TiffTags 常量名，语义写在旁边）
TAG_WIDTH = 256
TAG_HEIGHT = 257
TAG_BITS_PER_SAMPLE = 258
TAG_COMPRESSION = 259
TAG_PHOTO_INTERPRETATION = 262
TAG_FILL_ORDER = 266
TAG_STRIP_OFFSETS = 273
TAG_SAMPLES_PER_PIXEL = 277
TAG_ROWS_PER_STRIP = 278
TAG_STRIP_BYTE_COUNTS = 279
TAG_PLANAR_CONFIG = 284
TAG_PREDICTOR = 317
TAG_COLORMAP = 320
TAG_TILE_WIDTH = 322
TAG_TILE_LENGTH = 323
TAG_TILE_OFFSETS = 324
TAG_TILE_BYTE_COUNTS = 325
TAG_SAMPLE_FORMAT = 339
TAG_JPEG_TABLES = 347
TAG_JPEG_IF_OFFSET = 513
TAG_JPEG_IF_BYTE_COUNT = 514
TAG_XMP = 700
TAG_PHOTOSHOP_IRB = 34377
TAG_ICC_PROFILE = 34675

# 写进 JPEG 的 EXIF 前要剔除的标签：
#   - 像素布局类（宽高、位深、条带偏移等）换成 JPEG 后即失真；
#   - XMP 走标准 APP1 段写入（见 _save_jpeg），不再塞进 IFD0；
#   - Photoshop ImageResources 在 JPEG 里没有对应位置。
_LAYOUT_TAGS = {
    TAG_WIDTH,
    TAG_HEIGHT,
    TAG_BITS_PER_SAMPLE,
    TAG_COMPRESSION,
    TAG_PHOTO_INTERPRETATION,
    TAG_FILL_ORDER,
    TAG_STRIP_OFFSETS,
    TAG_SAMPLES_PER_PIXEL,
    TAG_ROWS_PER_STRIP,
    TAG_STRIP_BYTE_COUNTS,
    TAG_PLANAR_CONFIG,
    TAG_PREDICTOR,
    TAG_COLORMAP,
    TAG_TILE_WIDTH,
    TAG_TILE_LENGTH,
    TAG_TILE_OFFSETS,
    TAG_TILE_BYTE_COUNTS,
    TAG_SAMPLE_FORMAT,
    TAG_JPEG_TABLES,
    TAG_JPEG_IF_OFFSET,
    TAG_JPEG_IF_BYTE_COUNT,
    TAG_ICC_PROFILE,
    TAG_XMP,
    TAG_PHOTOSHOP_IRB,
}

COMPRESSION_NONE = 1
COMPRESSION_DEFLATE = {8, 32946}  # 标准 Deflate 与 Adobe Deflate

# APP1 段的 XMP 载荷上限（Pillow 超出会直接抛错，这里提前拦掉）
MAX_XMP_BYTES = 65000

# XMP 里的方向声明：Pillow 读 JPEG 时会用它补出 EXIF 方向标签（Image.py 的 Exif.load），
# 所以像素摆正后必须一起改掉，否则某些查看器会再转一次。
_XMP_ORIENTATION_RE = re.compile(
    rb'(?P<pre>(?:tiff|exif):Orientation\s*=\s*(?P<q>"|\'))(?P<val>[1-8])(?P<post>(?P=q))'
)

# EXIF Orientation -> 无损旋转/翻转操作（与 Pillow 内部映射一致）
ORIENTATION_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}

# 还原"文件里存储的像素布局"所需的逆操作（--no-rotate 用）
ORIENTATION_INVERSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_90,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_270,
}


# --------------------------------------------------------------------------- #
# 参数结构
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Options:
    """可跨进程传递的转换选项。"""

    quality: int = 95
    subsampling: int = 0
    progressive: bool = False
    background: tuple = (255, 255, 255)
    keep_exif: bool = True
    keep_icc: bool = True
    rotate: bool = True
    overwrite: bool = False
    dry_run: bool = False
    pages: str = "first"
    optimize: bool = True


@dataclass
class Result:
    src: Path
    outputs: list = field(default_factory=list)
    status: str = "ok"  # ok | skipped | partial | failed | dry-run
    width: int = 0
    height: int = 0
    mode: str = ""
    frames: int = 1
    src_bytes: int = 0
    dst_bytes: int = 0
    notes: list = field(default_factory=list)
    error: str = ""
    seconds: float = 0.0


# --------------------------------------------------------------------------- #
# 色彩通道处理
# --------------------------------------------------------------------------- #


def _scale_integer_to_uint8(array, full_scale: int):
    """整数样本按满量程线性映射到 0..255（四舍五入，保留最大精度）。

    16 位用整数运算实现：255/65535 恰好等于 1/257，因此 round(v/257) 与
    round(v*255/65535) 完全等价，且没有浮点误差、没有 8 字节中间数组。
    """
    if full_scale == 65535:
        return ((array.astype(np.uint32) + 128) // 257).astype(np.uint8)
    if full_scale == 255:
        return np.clip(array, 0, 255).astype(np.uint8)
    work = np.clip(array, 0, full_scale).astype(np.float32)
    work *= np.float32(255.0 / full_scale)
    np.rint(work, out=work)
    return work.astype(np.uint8)


def _high_bitdepth_to_gray8(im: Image.Image, notes: list):
    """16/32 位灰度 -> 8 位灰度数组；返回 None 表示交由调用方降级。"""
    if np is None:
        notes.append("未安装 numpy，高位深图像按 Pillow 默认方式降级")
        return None

    arr = np.asarray(im)

    if arr.dtype.kind == "f":  # 32 位浮点 TIFF
        high = float(arr.max()) if arr.size else 1.0
        if high <= 1.0:
            notes.append("浮点样本按 0..1 归一化")
            out = np.rint(np.clip(arr, 0.0, 1.0) * 255.0)
        elif high > 0:
            notes.append(f"浮点样本按最大值 {high:.4g} 归一化")
            out = np.rint(np.clip(arr, 0.0, None) * (255.0 / high))
        else:
            out = arr * 0
        return out.astype(np.uint8)

    if arr.dtype.kind not in ("i", "u"):
        return None

    bits = getattr(im, "tag_v2", {}).get(TAG_BITS_PER_SAMPLE)
    if isinstance(bits, (tuple, list)):
        bits = bits[0] if bits else None
    if not isinstance(bits, int) or not 1 <= bits <= 32:
        # 位深标签不可用：按数据范围挑最接近的常见满量程，避免暗图被拉过曝
        high = int(arr.max()) if arr.size else 0
        bits = next((b for b in (8, 12, 16) if high <= (1 << b) - 1), 16)

    full_scale = (1 << bits) - 1
    if int(arr.min()) < 0:
        notes.append("存在有符号/负值样本，负值已按 0 处理")
    if bits != 8:
        notes.append(f"按 {bits} 位满量程缩放到 8 位")
    return _scale_integer_to_uint8(arr, full_scale)


def _tiff_byte_order(im: Image.Image) -> str:
    """从 TIFF 文件头推样本字节序，用于自行解码 16 位样本。"""
    try:
        with open(im.filename, "rb") as fp:
            head = fp.read(2)
    except Exception:
        return "<"
    return "<" if head == b"II" else ">"


def _read_strip(fp, offset: int, count: int, compression) -> bytes | None:
    """读取一条条带并按需解压；返回 None 表示读不到完整数据。"""
    fp.seek(offset)
    chunk = fp.read(count)
    if len(chunk) != count:
        return None
    if compression in COMPRESSION_DEFLATE:
        try:
            chunk = zlib.decompress(chunk)
        except zlib.error:
            return None
    return chunk


def _exact_16bit_rgb(im: Image.Image, notes: list):
    """精确解码 16 位 RGB TIFF；无法精确处理时返回 None 并说明原因。"""
    if np is None:
        notes.append("未安装 numpy，16 位 RGB 只能保留 8 位精度")
        return None

    tags = getattr(im, "tag_v2", None)
    if tags is None or not getattr(im, "filename", None):
        return None

    bits = tags.get(TAG_BITS_PER_SAMPLE)
    if not (isinstance(bits, tuple) and len(bits) == 3 and set(bits) == {16}):
        return None
    if tags.get(TAG_SAMPLES_PER_PIXEL, 3) != 3:
        return None
    if tags.get(TAG_PLANAR_CONFIG, 1) != 1:
        notes.append("16 位 RGB（planar 排列）无法精确解码，已按 8 位精度转换")
        return None
    compression = tags.get(TAG_COMPRESSION, COMPRESSION_NONE)
    if compression != COMPRESSION_NONE and compression not in COMPRESSION_DEFLATE:
        notes.append("16 位 RGB（压缩方式未支持）已按 8 位精度转换")
        return None
    predictor = tags.get(TAG_PREDICTOR, 1)
    if predictor not in (None, 1, 2):
        notes.append(f"16 位 RGB（predictor={predictor}）已按 8 位精度转换")
        return None
    if compression == COMPRESSION_NONE:
        # Predictor 只对压缩数据流有意义；libtiff 及主流读取器在未压缩时都会忽略它，
        # 这里保持一致，避免与其它工具显示的结果不同。
        predictor = 1

    width, height = im.size
    offsets = tags.get(TAG_STRIP_OFFSETS)
    counts = tags.get(TAG_STRIP_BYTE_COUNTS)
    if offsets is None or counts is None:
        return None
    if not isinstance(offsets, (tuple, list)):
        offsets = (offsets,)
    if not isinstance(counts, (tuple, list)):
        counts = (counts,)
    if len(offsets) != len(counts) or not offsets:
        return None

    rows_per_strip = tags.get(TAG_ROWS_PER_STRIP) or height
    if not isinstance(rows_per_strip, int) or rows_per_strip < 1:
        rows_per_strip = height

    dtype = np.dtype(f"{_tiff_byte_order(im)}u2")
    out = np.empty((height, width, 3), dtype=np.uint8)
    row = 0
    # 逐条带解码，峰值内存 = 输出 + 单条条带，避免整幅 16 位数据常驻
    with open(im.filename, "rb") as fp:
        for offset, count in zip(offsets, counts):
            strip_rows = min(rows_per_strip, height - row)
            if strip_rows <= 0:
                break
            chunk = _read_strip(fp, offset, count, compression)
            if chunk is None:
                notes.append("16 位 RGB 条带数据不完整，已按 8 位精度转换")
                return None
            needed = strip_rows * width * 3 * 2
            if len(chunk) < needed:
                notes.append("16 位 RGB 条带长度与尺寸不符，已按 8 位精度转换")
                return None
            samples = np.frombuffer(chunk[:needed], dtype=dtype).reshape(strip_rows, width, 3)
            if predictor == 2:
                # 水平差分：每行按通道累加还原（模 2^16）
                samples = np.cumsum(samples, axis=1, dtype=np.uint32).astype(np.uint16)
            out[row:row + strip_rows] = _scale_integer_to_uint8(samples, 65535)
            row += strip_rows

    if row != height:
        notes.append("16 位 RGB 条带行数不足，已按 8 位精度转换")
        return None
    notes.append("16 位 RGB 已按原始样本精确缩放")
    return out


def _flatten_alpha(im: Image.Image, background, notes: list):
    """把带透明通道的图像合成到纯色背景上（JPEG 不支持透明）。"""
    rgba = im.convert("RGBA")
    canvas = Image.new("RGBA", rgba.size, (background[0], background[1], background[2], 255))
    notes.append(f"透明通道已合成到背景色 RGB{tuple(background)}")
    return Image.alpha_composite(canvas, rgba).convert("RGB")


def _cmyk_like_to_rgb(im: Image.Image, opts: Options, notes: list):
    """CMYK / LAB -> sRGB，优先走内嵌 ICC。返回 (图像, 需写入的新 ICC 或 None)。"""
    icc = im.info.get("icc_profile")
    if opts.keep_icc and icc and ImageCms is not None:
        try:
            srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
            converted = ImageCms.profileToProfile(
                im,
                ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                srgb,
                outputMode="RGB",
                renderingIntent=ImageCms.Intent.PERCEPTUAL,
            )
            notes.append(im.mode + "->sRGB（按内嵌 ICC 转换）")
            return converted, srgb.tobytes()
        except Exception as exc:
            notes.append(f"ICC 转换失败（{exc}），改用简易换算")
    return im.convert("RGB"), None


def to_rgb(im: Image.Image, opts: Options, notes: list):
    """把任意 TIFF 像素格式转成 JPEG 可写的 RGB。返回 (图像, 新 ICC 或 None)。"""
    mode = im.mode

    if mode == "RGB":
        exact = _exact_16bit_rgb(im, notes)
        if exact is not None:
            return Image.fromarray(exact, "RGB"), None
        bits = getattr(im, "tag_v2", {}).get(TAG_BITS_PER_SAMPLE)
        if isinstance(bits, tuple) and max(bits) > 8:
            notes.append("该文件每通道位数 > 8，读取阶段精度已被解码器截断")
        return im, None

    if mode == "1":  # 二值黑白扫描件
        notes.append("二值图像已转为灰度再输出")
        return im.convert("L").convert("RGB"), None

    if mode == "L":
        return im.convert("RGB"), None

    if mode == "P":
        if "transparency" in im.info:
            return _flatten_alpha(im, opts.background, notes), None
        return im.convert("RGB"), None

    if mode in ("RGBA", "LA", "PA", "RGBa", "La"):
        return _flatten_alpha(im, opts.background, notes), None

    if mode == "CMYK":
        return _cmyk_like_to_rgb(im, opts, notes)

    if mode == "LAB":
        return _cmyk_like_to_rgb(im, opts, notes)

    if mode == "YCbCr":
        return im.convert("RGB"), None

    if mode.startswith("I;16") or mode in ("I", "F"):
        gray = _high_bitdepth_to_gray8(im, notes)
        if gray is not None:
            notes.append("高位深灰度已显式缩放到 8 位")
            return Image.fromarray(gray, "L").convert("RGB"), None
        return im.convert("RGB"), None

    # 兜底：其它少见模式（如 BGR;16、RGBX）交给 Pillow
    notes.append(f"未特别处理的色彩模式 {mode}，交由 Pillow 转换")
    return im.convert("RGB"), None


# --------------------------------------------------------------------------- #
# 元数据
# --------------------------------------------------------------------------- #


def _valid_dpi(value):
    if not value or not isinstance(value, (tuple, list)) or len(value) != 2:
        return None
    x, y = float(value[0]), float(value[1])
    # 1x1 dpi 只是 Pillow 的占位默认值，写进 JPEG 反而误导
    if x <= 1.0 and y <= 1.0:
        return None
    if not (1.0 <= x <= 100000.0 and 1.0 <= y <= 100000.0):
        return None
    return (x, y)


def _read_orientation(im: Image.Image):
    """读文件里真实的方向标签（TIFF 标签优先，因为 Pillow 加载后会删掉它）。"""
    tags = getattr(im, "tag_v2", None)
    if tags is not None and 274 in tags:
        return int(tags[274])
    if tags is not None:
        return None  # 是 TIFF，但没有方向标签
    try:
        value = im.getexif().get(274)
    except Exception:
        return None
    return int(value) if value is not None else None


def _xmp_orientation_value(xmp):
    """从 XMP 里取方向声明；没有则返回 None。"""
    if not xmp:
        return None
    match = _XMP_ORIENTATION_RE.search(xmp)
    return int(match.group("val")) if match else None


def _orientation_step(im: Image.Image, rotate: bool, notes: list):
    """决定还需要对像素做什么，返回 (转置方法或 None, 是否删除方向标签, 需写回的方向值)。

    关键：Pillow 12 在 `load()` 时就会按 EXIF 方向自动摆正像素，并从 tag_v2 删除方向标签
    （TiffImagePlugin.load_end 里调用了 exif_transpose(in_place=True)）。
    所以这里先读一次方向、加载后再读一次：标签在加载后消失 = Pillow 已经摆正过，
    此时绝不能再转一次（否则方向 6 会变成 180 度倒置）。
    """
    raw_before = _read_orientation(im)
    xmp_orientation = _xmp_orientation_value(im.info.get("xmp"))
    before = raw_before if raw_before is not None else xmp_orientation
    im.load()
    # Pillow 12+ 在 load() 时按方向摆正像素：有标签时会把标签删掉，
    # 只有 XMP 声明方向时（Pillow 用 getexif() 读到注入值）标签本来就不存在。
    applied_by_pillow = raw_before not in (None, 1) and _read_orientation(im) is None
    if not applied_by_pillow and raw_before is None and xmp_orientation not in (None, 1):
        applied_by_pillow = True

    if rotate:
        if before is None:
            return None, False, None
        # 只要源里带方向标签，最终像素就是"显示态"，输出里不该再留这个标签：
        # 方向 1 虽等价于不旋转，但它已无意义；其它值留着会导致重复旋转。
        if before == 1:
            return None, True, None
        notes.append("已按 EXIF 方向无损旋转")
        if applied_by_pillow:
            return None, True, None
        return ORIENTATION_TRANSPOSE.get(before), True, None

    # --no-rotate：把像素还原成文件里存储的布局，并保留方向标签
    if applied_by_pillow:
        notes.append("已还原为文件存储的像素布局（--no-rotate）")
        return ORIENTATION_INVERSE.get(before), False, before
    return None, False, None


def _exif_bytes(im: Image.Image, notes: list, drop_orientation: bool = False,
                set_orientation=None):
    """构造要写入 JPEG 的 EXIF。"""
    try:
        exif = im.getexif()
    except Exception:
        return None
    if not exif:
        return None
    for tag in _LAYOUT_TAGS:
        exif.pop(tag, None)
    if drop_orientation:
        exif.pop(274, None)  # 像素已按方向摆正，方向标签必须清掉
    elif set_orientation:
        exif[274] = set_orientation  # --no-rotate 时补回原始方向值
    try:
        return exif.tobytes()
    except Exception as exc:
        notes.append(f"EXIF 写入失败（{exc}），已跳过元数据")
        return None


def _normalize_xmp_orientation(xmp, notes: list):
    """像素已摆正时，把 XMP 里的方向声明改成 1，避免查看器二次旋转。"""
    if not xmp:
        return xmp

    def replace(match):
        if match.group("val") == b"1":
            return match.group(0)
        notes.append("XMP 内的方向声明已同步为 1（像素已摆正）")
        return match.group("pre") + b"1" + match.group("post")

    return _XMP_ORIENTATION_RE.sub(replace, xmp)


# --------------------------------------------------------------------------- #
# 单文件转换
# --------------------------------------------------------------------------- #


def _select_frames(n_frames: int, selector: str):
    if n_frames <= 1:
        return [0]
    if selector == "all":
        return list(range(n_frames))
    if selector.isdigit():
        return [max(0, min(n_frames - 1, int(selector) - 1))]
    return [0]


def _output_paths(dst: Path, frames: list, total_frames: int):
    if len(frames) == 1 and frames[0] == 0:
        return [dst]
    return [dst.with_name(f"{dst.stem}_p{index + 1:02d}{dst.suffix}") for index in frames]


def _save_jpeg(rgb, target: Path, opts: Options, dpi, exif_bytes, icc, xmp, notes: list) -> int:
    """写 JPEG：先写临时文件再原子替换，绝不留半截文件。

    optimize=True 时 Pillow 会按估算值给 libjpeg 分配输出缓冲（quality>=95 时
    每像素 2 字节），一旦实际压缩数据超出该估算（噪点多的照片很常见）就会抛
    OSError("broken data stream")。这里自动退回普通编码：只影响体积，不影响画质。
    """
    save_kwargs = {
        "format": "JPEG",
        "quality": opts.quality,
        "subsampling": opts.subsampling,
        "progressive": opts.progressive,
    }
    if dpi:
        save_kwargs["dpi"] = dpi
    if exif_bytes:
        save_kwargs["exif"] = exif_bytes
    if icc:
        save_kwargs["icc_profile"] = icc
    if xmp:
        if len(xmp) <= MAX_XMP_BYTES:
            save_kwargs["xmp"] = xmp
        else:
            notes.append(f"XMP 元数据过大（{len(xmp)} 字节），已跳过")

    tmp = target.with_name(f".{target.name}.{os.getpid()}.part")
    attempts = [True, False] if opts.optimize else [False]
    last_error = None
    for optimize in attempts:
        try:
            with open(tmp, "wb") as fp:
                rgb.save(fp, optimize=optimize, **save_kwargs)
        except (OSError, MemoryError, ValueError) as exc:
            last_error = exc
            continue
        os.replace(tmp, target)
        if not optimize and opts.optimize:
            notes.append("optimize 编码超出 Pillow 缓冲上限，已回退为普通编码（体积略大，画质不变）")
        return target.stat().st_size

    if tmp.exists():
        try:
            tmp.unlink()
        except OSError:
            pass
    raise last_error if last_error else RuntimeError("JPEG 写入失败")


def convert_file(task):
    src_str, dst_str, opts = task
    src_path, dst = Path(src_str), Path(dst_str)
    started = time.perf_counter()
    notes: list = []
    result = Result(src=src_path)

    try:
        result.src_bytes = src_path.stat().st_size
    except OSError:
        pass

    try:
        with Image.open(src_path) as im:
            n_frames = getattr(im, "n_frames", 1)
            frames = _select_frames(n_frames, opts.pages)
            result.frames = n_frames
            result.mode = im.mode
            if n_frames > 1 and opts.pages == "first":
                notes.append(f"多页 TIFF（共 {n_frames} 页），仅转换第 1 页")

            pending = list(zip(frames, _output_paths(dst, frames, n_frames)))
            if not opts.overwrite:
                for _, target in pending:
                    if target.exists():
                        notes.append(f"输出已存在，跳过：{target.name}")
                pending = [(f, t) for f, t in pending if not t.exists()]
            if not pending:
                result.status = "skipped"
                result.notes = notes
                result.seconds = time.perf_counter() - started
                return result

            for frame_index, target in pending:
                im.seek(frame_index)
                dpi = _valid_dpi(im.info.get("dpi"))
                source_icc = im.info.get("icc_profile") if opts.keep_icc else None
                source_xmp = im.info.get("xmp") if opts.keep_exif else None
                method, drop_orientation, force_orientation = _orientation_step(
                    im, opts.rotate, notes
                )

                # 注意：必须用原始 TIFF 对象做像素转换，因为 Image.copy() 会丢掉
                # tag_v2 与 filename，而 16 位精确解码依赖它们。
                rgb, new_icc = to_rgb(im, opts, notes)
                if method is not None:
                    rgb = rgb.transpose(method)
                if new_icc is not None:
                    source_icc = new_icc
                if rgb.mode != "RGB":
                    rgb = rgb.convert("RGB")
                if drop_orientation:
                    source_xmp = _normalize_xmp_orientation(source_xmp, notes)

                result.width, result.height = rgb.size
                exif_bytes = None
                if opts.keep_exif:
                    exif_bytes = _exif_bytes(
                        im, notes,
                        drop_orientation=drop_orientation,
                        set_orientation=force_orientation,
                    )

                if opts.dry_run:
                    result.outputs.append(target)
                    continue

                target.parent.mkdir(parents=True, exist_ok=True)
                result.outputs.append(target)
                result.dst_bytes += _save_jpeg(
                    rgb, target, opts, dpi, exif_bytes, source_icc, source_xmp, notes
                )

        result.status = "dry-run" if opts.dry_run else "ok"
        if any("跳过" in note for note in notes):
            result.status = "partial"
    except Exception as exc:
        result.status = "failed"
        result.error = f"{type(exc).__name__}: {exc}"

    result.notes = notes
    result.seconds = time.perf_counter() - started
    return result


# --------------------------------------------------------------------------- #
# 输入收集 / 输出路径
# --------------------------------------------------------------------------- #


def collect_inputs(paths, extensions, recursive: bool):
    found = []
    for path in paths:
        if path.is_dir():
            pattern = "**/*" if recursive else "*"
            for candidate in sorted(path.glob(pattern)):
                if candidate.is_file() and candidate.suffix.lower().lstrip(".") in extensions:
                    found.append(candidate)
        elif path.is_file():
            found.append(path)
        else:
            raise SystemExit(f"输入不存在：{path}")
    return found


def pool_context():
    """优先用 fork：启动快，且不要求调用方在 __main__ 里加守卫。"""
    import multiprocessing as mp

    for method in ("fork", "spawn"):
        try:
            return mp.get_context(method)
        except (ValueError, AttributeError):
            continue
    return None


def resolve_destination(src: Path, input_roots, out_arg):
    """算出输出路径；目录输入时保留相对子目录结构。"""
    if out_arg is None:
        return src.with_suffix(".jpg")
    for root in input_roots:
        if root.is_dir():
            try:
                relative = src.resolve().relative_to(root.resolve())
            except ValueError:
                continue
            return (out_arg / relative).with_suffix(".jpg")
    if out_arg.suffix.lower() == ".jpg":
        return out_arg
    return (out_arg / src.name).with_suffix(".jpg")


def resolve_collisions(jobs):
    """两个源映射到同一输出（如 a.tif 与 a.TIFF）时自动改名，避免互相覆盖。"""
    seen = {}
    resolved = []
    for src, dst in jobs:
        key = dst
        if key in seen and seen[key] != src:
            other = seen[key]
            counter = 1
            candidate = dst.with_name(f"{dst.stem}-{counter}{dst.suffix}")
            while candidate in seen or candidate.exists():
                counter += 1
                candidate = dst.with_name(f"{dst.stem}-{counter}{dst.suffix}")
            print(f"注意：{src.name} 与 {other.name} 输出同名，改用 {candidate.name}")
            dst = candidate
            key = dst
        seen[key] = src
        resolved.append((src, dst))
    return resolved


# --------------------------------------------------------------------------- #
# 输出格式
# --------------------------------------------------------------------------- #


def human_size(num_bytes: float) -> str:
    """按十进制单位格式化，与 Finder / du 显示的口径一致。"""
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if abs(value) < 1000 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1000
    return f"{value:.1f} GB"


def print_result(index: int, total: int, result: Result, quiet: bool) -> None:
    prefix = f"[{index}/{total}]"
    if result.status == "failed":
        print(f"{prefix} 失败 {result.src.name}：{result.error}", flush=True)
        return
    if result.status == "skipped":
        if not quiet:
            print(f"{prefix} 跳过 {result.src.name}（输出已存在）", flush=True)
        return
    target = ", ".join(p.name for p in result.outputs) or "-"
    size_note = ""
    if result.dst_bytes:
        size_note = f"  {human_size(result.src_bytes)} -> {human_size(result.dst_bytes)}"
    print(
        f"{prefix} 完成 {result.src.name} -> {target}  "
        f"{result.width}x{result.height} {result.mode}{size_note}  ({result.seconds:.1f}s)",
        flush=True,
    )
    if not quiet:
        for note in dict.fromkeys(result.notes):
            print(f"        · {note}", flush=True)


def write_report(path: Path, results) -> None:
    with path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.writer(fp)
        writer.writerow(
            ["source", "output", "status", "width", "height", "mode", "frames",
             "src_bytes", "dst_bytes", "notes", "error", "seconds"]
        )
        for result in results:
            writer.writerow(
                [
                    result.src,
                    "; ".join(str(p) for p in result.outputs),
                    result.status,
                    result.width,
                    result.height,
                    result.mode,
                    result.frames,
                    result.src_bytes,
                    result.dst_bytes,
                    " | ".join(dict.fromkeys(result.notes)),
                    result.error,
                    f"{result.seconds:.2f}",
                ]
            )


# --------------------------------------------------------------------------- #
# 命令行
# --------------------------------------------------------------------------- #


COLOR_NAMES = {
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "gray": (128, 128, 128),
    "grey": (128, 128, 128),
}


def parse_background(raw: str):
    text = raw.strip().lower()
    if text in COLOR_NAMES:
        return COLOR_NAMES[text]
    if text.startswith("#"):
        digits = text[1:]
        if len(digits) == 3:
            digits = "".join(ch * 2 for ch in digits)
        if len(digits) == 6:
            return tuple(int(digits[i:i + 2], 16) for i in (0, 2, 4))
    parts = text.replace("，", ",").split(",")
    if len(parts) == 3:
        try:
            values = tuple(int(float(p)) for p in parts)
        except ValueError:
            values = None
        if values and all(0 <= v <= 255 for v in values):
            return values
    raise argparse.ArgumentTypeError(f"无法解析背景色：{raw}（示例：white、#f5f5f5、255,255,255）")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tiff2jpg.py",
        description="批量把 TIFF 转成高质量 JPEG：像素尺寸 1:1、不缩放、保留 ICC/EXIF 与 DPI。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  python3 scripts/tiff2jpg.py ~/Pictures/tiff\n"
            "  python3 scripts/tiff2jpg.py ~/Pictures/tiff -o ~/Pictures/jpg -r -j 4\n"
            "  python3 scripts/tiff2jpg.py photo.tif -o out.jpg --quality 97\n"
            "  python3 scripts/tiff2jpg.py in/ -o out/ --dry-run --report report.csv\n"
        ),
    )
    parser.add_argument("input", nargs="+", type=Path, help="TIFF 文件或目录")
    parser.add_argument(
        "-o",
        "--output",
        default=None,
        type=Path,
        help="输出目录或 .jpg 文件（省略则与源文件同目录，文件名为 xxx.jpg）",
    )
    parser.add_argument("-r", "--recursive", action="store_true", help="递归处理子目录")
    parser.add_argument(
        "--ext", default=",".join(DEFAULT_EXTENSIONS),
        help="输入扩展名，逗号分隔（默认 tif,tiff）",
    )
    parser.add_argument("-q", "--quality", type=int, default=95, help="JPEG 质量 1-100（默认 95）")
    parser.add_argument(
        "--subsampling", type=int, choices=(0, 1, 2), default=0,
        help="色度抽样：0=4:4:4 不抽样（默认，最保真）、1=4:2:2、2=4:2:0（文件更小）",
    )
    parser.add_argument("--progressive", action="store_true", help="输出渐进式 JPEG（默认基线式，兼容性最好）")
    parser.add_argument(
        "--no-optimize", action="store_true",
        help="关闭无损 Huffman 优化（默认开启，遇到 Pillow 缓冲上限会自动回退）",
    )
    parser.add_argument(
        "--background", type=parse_background, default=(255, 255, 255), metavar="COLOR",
        help="透明区域的填充色（默认 white）",
    )
    parser.add_argument(
        "--pages", default="first", metavar="first|all|N",
        help="多页 TIFF 处理哪一页（默认 first，可选 all 或页码）",
    )
    parser.add_argument("--no-exif", action="store_true", help="不写 EXIF/XMP 元数据")
    parser.add_argument("--no-icc", action="store_true", help="不写 ICC 描述文件")
    parser.add_argument("--no-rotate", action="store_true", help="不按 EXIF 方向旋转（仅保留方向标签）")
    parser.add_argument("-f", "--overwrite", action="store_true", help="覆盖已存在的输出（默认跳过）")
    parser.add_argument("-n", "--dry-run", action="store_true", help="只列出将要执行的操作，不写文件")
    parser.add_argument("--report", type=Path, help="把每个文件的处理结果写入 CSV")
    parser.add_argument("-j", "--jobs", type=int, default=0, help="并行进程数（默认最多 4，0 表示自动）")
    parser.add_argument("--quiet", action="store_true", help="只输出汇总，不打印单文件明细")
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not 1 <= args.quality <= 100:
        parser.error("--quality 必须在 1-100 之间")
    if args.pages not in ("first", "all") and not args.pages.isdigit():
        parser.error("--pages 只能是 first、all 或页码数字")
    if args.jobs < 0:
        parser.error("--jobs 不能为负数")

    input_roots = list(args.input)
    extensions = {e.strip().lower().lstrip(".") for e in args.ext.split(",") if e.strip()}
    sources = collect_inputs(input_roots, extensions, args.recursive)
    if not sources:
        print(f"没有找到匹配的文件（扩展名：{', '.join(sorted(extensions))}）")
        return 0
    if args.output is not None and len(sources) > 1 and args.output.suffix.lower() == ".jpg":
        parser.error("输出为单个 .jpg 文件时只能对应一个输入文件")

    jobs = resolve_collisions(
        [(src, resolve_destination(src, input_roots, args.output)) for src in sources]
    )

    opts = Options(
        quality=args.quality,
        subsampling=args.subsampling,
        progressive=args.progressive,
        background=args.background,
        keep_exif=not args.no_exif,
        keep_icc=not args.no_icc,
        rotate=not args.no_rotate,
        overwrite=args.overwrite,
        dry_run=args.dry_run,
        pages=args.pages,
        optimize=not args.no_optimize,
    )

    workers = args.jobs if args.jobs > 0 else min(4, os.cpu_count() or 1)
    workers = max(1, min(workers, len(jobs)))

    sampling_name = {0: "4:4:4 不抽样", 1: "4:2:2", 2: "4:2:0"}[opts.subsampling]
    if not args.quiet:
        print(
            f"共 {len(jobs)} 个文件 | JPEG 质量 {opts.quality} | 色度 {sampling_name} | "
            f"{'渐进式' if opts.progressive else '基线式'} | 并行 {workers} | 不缩放，像素 1:1"
        )
        if args.dry_run:
            print("dry-run：只列出计划，不写文件")

    started = time.perf_counter()
    results = []
    tasks = [(str(src), str(dst), opts) for src, dst in jobs]

    if workers == 1:
        for index, task in enumerate(tasks, 1):
            result = convert_file(task)
            results.append(result)
            if not args.quiet:
                print_result(index, len(tasks), result, args.quiet)
    else:
        with ProcessPoolExecutor(max_workers=workers, mp_context=pool_context()) as pool:
            futures = [pool.submit(convert_file, task) for task in tasks]
            for index, future in enumerate(as_completed(futures), 1):
                result = future.result()
                results.append(result)
                if not args.quiet:
                    print_result(index, len(tasks), result, args.quiet)

    elapsed = time.perf_counter() - started
    order = {str(src): index for index, (src, _) in enumerate(jobs)}
    results.sort(key=lambda r: order.get(str(r.src), 0))

    done = [r for r in results if r.status in ("ok", "partial", "dry-run")]
    skipped = [r for r in results if r.status == "skipped"]
    failed = [r for r in results if r.status == "failed"]
    src_total = sum(r.src_bytes for r in done)
    dst_total = sum(r.dst_bytes for r in results)
    ratio = f"，源文件合计 {human_size(src_total)}" if src_total else ""

    print(
        f"\n完成：成功 {len(done)}，跳过 {len(skipped)}，失败 {len(failed)}，耗时 {elapsed:.1f}s"
        + (f"，输出合计 {human_size(dst_total)}{ratio}" if dst_total else "")
    )

    truncated = [r for r in results if any("已被解码器截断" in n for n in r.notes)]
    if truncated:
        print(f"提示：{len(truncated)} 个文件每通道位数 > 8 且无法精确解码（详见上方单文件说明）")
    fallback = [r for r in results if any("回退为普通编码" in n for n in r.notes)]
    if fallback:
        print(f"提示：{len(fallback)} 个文件因 Pillow 缓冲上限回退为普通编码（体积略大，画质不变）")
    if failed:
        print("失败清单：")
        for result in failed:
            print(f"  · {result.src}：{result.error}")
    if args.dry_run:
        print("以上为 dry-run 结果，未写入任何文件。")

    if args.report:
        write_report(args.report, results)
        print(f"报告已写入 {args.report}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
