# DSH Live Speed · 实时速度看板

[English](README.en.md) · MIT License

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 输入框下方的活动栏提供实时正文速度、首 token 等待时间、上一步模型吞吐，以及会话模型/工具耗时。支持中英文、明暗主题及原生简洁模式，无第三方运行依赖。

## 兼容性

当前版本 **0.2.7**，适配 **DSH 0.2.2-rc.3** 的 Web 客户端；其他 DSH 版本尚未验证。安装和测试工具使用 Node.js 22 或更新版本。插件使用 DSH 的模块加载器，不能作为独立网页运行。

## 安装

从本仓库 GitHub Releases 下载安装包后，使用 DSH 插件页导入 `.tgz`（如宿主提供导入入口），或运行：

```sh
dsh plugin add /absolute/path/dsh-live-speed-0.2.7.tgz
```

使用非默认 profile 时：

```sh
dsh plugin --profile your-profile add /absolute/path/dsh-live-speed-0.2.7.tgz
```

宿主按其插件加载流程重载后，在插件页启用或停用。此插件替换原生 `activity` 项，不替换原生 `usage`（token/缓存统计）项。插件管理器通过包内的 `dsh.bundle.patch` 插入宿主插件；不要再手动添加同名配置。卸载：`dsh plugin remove dsh-live-speed`。

## 读数口径

- **实时正文速度（字符/s）**：浏览器单调时钟计量最近 2.5 秒收到的正文 Unicode 码点（不是 UTF-16 长度，也不是用户感知字形）；保留 Markdown 标记，不计推理块和工具参数。窗口边界线性插值，采样不足 300 ms 暂不显示，停流后降至零。
- **首 token**：DSH 记录的模型步骤起点到第一个 token 的时间；第一个 token 可能是推理内容，并非首个可见正文。尚未收到 token 时显示等待时长。
- **上一步模型吞吐（tok/s）**：服务商上报的输出 token 数 / DSH 记录的首 token 到完成的时间。可能包含推理和工具参数，不能直接与正文字符/s 比较。缺少用量或有效时长时不显示。
- **会话平均吞吐及耗时**：读取宿主的 `sessionStats` 投影；不是各步骤速率的简单平均，也不是端到端网络延迟测试。

步骤、重试和会话切换会重置采样。浏览器后台节流、断线重连、批量传输、打开已在生成的会话等会影响实时读数；不推测打开页面前未观察到的正文速度。详细模式点击读数打开统计；简洁模式只保留读数。尊重系统减少动画设置。

## 隐私与边界

只读取浏览器侧原生 Chat、Trajectory 和会话统计；不发送网络请求、不上传正文、不持久化采样、不读取凭据或文件。宿主入口为空，仅用于加载插件。

活动栏使用公开 `conversation.composer.dock` 扩展点。为兼容当前宿主，用量弹层定位还依赖 `[data-session-stats-usage]`、`[data-turn-usage-details]` 和 body 下的 dialog DOM；这是版本敏感适配，不保证未来版本兼容。禁用时会释放监听器、observer、样式和插槽。

## 开发与打包

```sh
npm run check
npm test
mkdir -p release
npm pack --pack-destination release
```

不需要构建或安装依赖。源码即发行代码，`npm pack` 自动执行语法检查和测试；包内白名单只含入口、客户端、Cordis patch、许可证和文档，不含测试、历史包或本机配置。CI 对 Node.js 22/24 执行同样检查。逻辑测试使用 Node 内置 runner 与 VM mock。0.2.7 排版已另外在实际 Work 页面用 Chromium 截图，并对照原生用量弹层校验桌面明暗主题、移动视口的计算字体与颜色；此验收不代表覆盖全部生成流程。

参见 [更新记录](CHANGELOG.md)、[贡献说明](CONTRIBUTING.md) 与 [安全说明](SECURITY.md)。

## 授权

本插件由原作者确认拥有原创权利，按 [MIT](LICENSE) 开源。历史 0.1.0 原稿经适配演进至 0.2.x；DSH 是独立的上游项目，本插件并非官方维护。
