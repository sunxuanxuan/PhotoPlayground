# 背景候选素材

“背景替换”模式的候选项定义在 `src/lib/background-presets.ts`。候选图放入
`public/background-presets/` 后，会直接成为可一键选用的背景素材。

当前内置文件名：

- `beijing-tiananmen.jpeg`：北京天安门广场侧面纵向景
- `beijing-wumen.jpeg`：故宫午门
- `beijing-great-wall.jpeg`：北京长城
- `beijing-temple-of-heaven.jpeg`：北京天坛祈年殿
- `beijing-birds-nest.jpeg`：北京国家体育场鸟巢
- `beijing-universal-studios.jpeg`：北京环球影城
- `shanghai-lujiazui.jpeg`：上海陆家嘴
- `hangzhou-leifeng-pagoda.jpeg`：杭州西湖雷峰塔
- `jinan-daming-lake.jpeg`：济南大明湖
- `puer-tea-culture-wall.jpeg`：云南普洱茶文化墙
- `taipusi-grassland.jpeg`：内蒙古太仆寺旗草原
- `datong-yungang-grottoes-entrance.jpeg`：大同云冈石窟入口
- `datong-yungang-buddha.jpeg`：大同云冈石窟大佛
- `beijing-beihai-white-pagoda.jpeg`：北京北海公园白塔
- `kunming-airport.jpeg`：昆明长水机场打卡点
- `kunming-hello-wall.jpeg`：你好昆明打卡墙
- `puer-dai-jia-lane.jpeg`：普洱戴家巷
- `beijing-great-wall-overlook-vertical.jpeg`：北京长城山脊步道纵向景
- `beijing-birds-nest-plaza-vertical.jpeg`：北京鸟巢广场纵向景
- `shanghai-lujiazui-skyline-vertical.jpeg`：上海陆家嘴天际线纵向景
- `taipusi-grassland-castle-wide.jpeg`：太仆寺旗草原白色城堡横向景
- `xinjiang-flaming-mountains-monument.jpeg`：吐鲁番火焰山温度地标
- `xinjiang-kanas-moon-bay-vertical.jpeg`：喀纳斯月亮湾纵向景
- `xinjiang-tianshan-pasture-wide.jpeg`：天山雪峰牧场横向景
- `xinjiang-grassland-yurts-wide.jpeg`：天山草原毡房横向景
- `xinjiang-snow-mountain-boardwalk-vertical.jpeg`：雪山草原栈道纵向景
- `xinjiang-turpan-multilingual-wall-wide.jpeg`：吐鲁番多语种文化墙
- `xinjiang-turpan-grape-valley-book-vertical.jpeg`：吐鲁番葡萄沟课本雕塑纵向景
- `beijing-summer-palace-kunming-lake-vertical.jpeg`：北京颐和园昆明湖纵向景
- `beijing-beihai-white-pagoda-bridge-vertical.jpeg`：北京北海白塔与永安桥纵向景
- `beijing-temple-of-heaven-red-wall-vertical.jpeg`：北京天坛祈年殿红墙纵向景
- `beijing-great-wall-watchtower-vertical.jpeg`：北京长城敌楼近景纵向图
- `beijing-summer-palace-foxiang-pavilion-lakeside-vertical.jpeg`：北京颐和园佛香阁湖畔纵向景
- `beijing-pku-west-gate-vertical.jpeg`：北京大学西校门纵向景
- `beijing-tsinghua-university-gate-vertical.jpeg`：清华大学校门纵向景
- `beijing-old-summer-palace-ruins-vertical.jpeg`：北京圆明园大水法遗址纵向景
- `beijing-great-hall-of-people-wide.jpeg`：北京人民大会堂横向景

卡片缩略图放在 `public/background-presets/thumbnails/`，文件名与对应原图一致。

素材尚未放入时，候选卡会展示地点占位图，并且不会改动用户当前的背景图或提示词。
素材就绪后，点击卡片会自动设置背景参考图并填入提示词，两个动作会一起完成。

候选数据仍只保存地点、落位、裁切和待移除游客要求，避免在底稿中重复人物保护、透视或光线规则。用户选择候选时，前端使用统一构建函数把系统规则、候选要求和最终验收护栏完整拼接到输入框；输入框中的可见文本可编辑，并由服务端原样发送，不再隐藏追加。所有内置预设均保留原姿势，不授权转头、重构身体或降低面部辨识度，也不固定人物占比。当前天安门本地替换素材，以及长城敌楼近景、颐和园佛香阁湖畔和人民大会堂素材都没有可信的前景站立面，因此采用半身或大半身底边裁切，人物位于镜头与背景之间。

候选卡会显示空间兼容等级和推荐裁切：

- `A级 · 可自然落地`：存在明确地面、草坡或步道，可建立落点、遮挡和接触阴影，优先用于全身或四分之三身。
- `B级 · 需要前景锚定`：地面或深度锚点有限，需要利用栏杆、墙面或现有近景遮挡建立前后关系，优先使用四分之三身。
- `C级 · 仅建议半身`：缺少可信落地点，只适合较小比例的半身或胸像，二维贴片风险最高。

本地覆盖提示词如果明确写出“前景没有可见路面”“没有可见近景站立面”等条件，会自动降为 C 级，避免图片已替换但仍沿用原内置素材的落地等级。

新增候选项时，需要同时提供 `assetPath`、`thumbnailPath`、`assetFileName` 和不超过背景替换模式
提示词长度上限的 `prompt`。建议素材使用清晰、无水印、主体人物较少且透视关系明确的
JPG、PNG 或 WebP 图片。
