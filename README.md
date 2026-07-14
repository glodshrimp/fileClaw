# FileClaw - 开发者智能工作空间与项目管理器

FileClaw 是一款基于 **Tauri 2.0 + React + TypeScript + Rust** 构建的高性能、现代化的轻量级本地开发者工作空间（Developer Workspace）与项目管理系统。它融合了传统的 IDE 编码体验、多通道远程终端、可视化 Git 管理工具以及最前沿 of AI 辅助编程能力，旨在帮助开发者一站式管理项目、连接远程服务器与智能辅助开发。

---

## 🌟 核心特性

### 1. 智能项目与连接管理
* **项目仪表盘**：直观管理本地所有工程项目，分类与标签追踪，结合工程里程碑进度图表。
* **系统与系统节点管理**：集中式维护应用部署节点、环境配置以及 API 端口拓扑。
* **安全凭据保险箱 (Accounts)**：本地加密存储各平台的第三方凭据、服务器私钥，安全易用。

### 2. 深度定制的 IDE 工作区
* **多标签文件编辑器**：
  * 基于 **CodeMirror 6** 的高性能代码编辑，支持主流语言（Java, Rust, JavaScript, TypeScript, CSS, HTML, JSON, Vue 等）语法高亮。
  * **多媒体文件预览**：支持高保真本地 PDF 阅读和图像素材查看。
* **IntelliJ 级版本比对 (Diff Viewer)**：
  * 集成 **Monaco Diff Editor** 引擎，提供极致流畅的 Side-by-Side 双栏代码版本比对。
  * 智能适配文件语言高亮与无缝滚动。
* **内置本地终端 (Local Terminal)**：基于 `xterm.js` 并通过 Rust 后端虚拟终端（PTY）桥接，在标签页中直接开启流畅的本地 Shell 会话。

### 3. 一站式远程工作套件 (SSH & SFTP)
* **多终端会话管理**：支持与多个远程 Linux 服务器并发建立 SSH 会话，集成 `xterm.js` 进行全功能交互。
* **内置 SFTP 浏览器**：
  * 支持文件列表双向浏览、新建、重命名、权限修改与彻底删除。
  * 完备的多文件异步上传与下载传输队列，内置精美的实时进度与速度指示条。
* **SSH 端口转发 (SSH Tunneling)**：
  * 支持**本地端口转发**（Local Forwarding，例如将远程数据库映射到本地 `localhost`）。
  * 支持**远程端口转发**（Remote Forwarding）。
  * 支持一键开关控制和状态监听。

### 4. 深度交互式可视化 Git 控制台
* **未推送 Commit 审查 (IntelliJ Push Window)**：
  * 专为 Git Push 设计的分栏审查弹窗。
  * **左侧**展示即将 Push 的 Commit 信息（Hash、作者、日期、说明）。
  * **右侧**展示各 Commit 影响的变更文件目录树。
  * **行内分支管理**：在 Push 弹窗中支持一键创建并切换到新的本地分支，并自适应刷新计算待 Push 信息。
  * 支持普通推送与**强制推送**（`Force Push / with-lease`）。
* **可视操作流**：支持一键 Stash 暂存及恢复、分支检出、提交日志（History）深度追踪，并深度绑定双击比对功能。
* **多维 Diff 入口**：在推送窗口、提交窗口、历史日志窗口中**双击任意文件**，均可直接在右侧标签页开卡比对，提供沉浸式的改动审查。

### 5. 人工智能辅助编程 (AI Chat)
* **多模型提供商接入**：原生对接 Google Gemini、OpenAI 协议兼容模型。
* **工程上下文感知**：智能引入本地文件、项目路径，帮助生成代码、解 Bug 并支持会话上下文控制。

---

## 🛠️ 技术栈

* **前端 (Frontend)**:
  * [React 19](https://react.dev/) + TypeScript
  * [Tailwind CSS 4.0](https://tailwindcss.com/) (极速原子化样式与动画渲染)
  * [Zustand](https://github.com/pmndrs/zustand) (高性能全局状态管理)
  * [Monaco Editor & CodeMirror 6](https://microsoft.github.io/monaco-editor/) (双核编辑器支持)
  * [Lucide React](https://lucide.dev/) (精细矢量图标库)
* **后端 (Backend)**:
  * [Tauri 2.0](https://tauri.app/) (跨平台桌面应用架构)
  * [Rust](https://www.rust-lang.org/) (保障核心安全性、并发性与极速的 I/O)
  * Rust crates: `ssh2` (SSH 通道), `portable-pty` (虚拟终端桥接), `serde` 等。

---

## 🚀 快速开始

### 前提条件

1. 安装 **Node.js** (推荐 >= v18.0)
2. 安装 **Rust 编译环境** (通过 `rustup` 安装)
3. 对于 macOS 用户，需要安装 Xcode Command Line Tools；对于 Windows 用户，需要安装 C++ 生成工具。具体请参阅 [Tauri Prerequisites](https://tauri.app/v2/start/prerequisites/)。

### 开发调试

1. 克隆并进入项目根目录：
   ```bash
   cd FileClaw
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动开发模式（将同时拉起 Vite 开发服务器与 Tauri 桌面窗口）：
   ```bash
   npm run tauri dev
   ```

### 生产打包

生成对应平台的极小体积、高安全性独立安装包（如 macOS `.app` / `.dmg`，Windows `.msi` 等）：
```bash
npm run tauri build
```

### 🍎 macOS 安装常见问题（文件损坏打不开）

由于通过 GitHub Actions CI/CD 或本地未签名打包的 DMG 安装包在 macOS 下载后会受到系统的 Gatekeeper 隔离限制，启动时可能会提示 **“FileClaw 已损坏，打不开，您应该将它移到废纸篓”**。

这并不是应用包真的损坏，可以通过以下方法解决：

1. 将 `FileClaw.app` 拖入 **应用程序** (`/Applications`) 文件夹中。
2. 打开终端（Terminal），运行以下命令以移除隔离标识：
   ```bash
   sudo xattr -r -d com.apple.quarantine /Applications/FileClaw.app
   ```
3. 按回车并输入 Mac 的开机密码（输入时密码不展示），完成后即可正常双击启动应用。

---

## 📂 项目结构

```
FileClaw/
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── main.rs        # 应用主入口
│   │   ├── lib.rs         # Tauri Command 路由与生命周期管理
│   │   ├── git.rs         # Git 命令绑定底层实现
│   │   ├── ssh.rs         # SSH/SFTP 连接、隧道与命令操作管理
│   │   ├── pty.rs         # PTY 进程创建与管道交互逻辑
│   │   └── fs.rs          # 本地文件系统安全访问命令
│   └── Cargo.toml         # Rust 依赖声明
├── src/                   # React 前端
│   ├── components/        # 公用 UI 组件与终端控件
│   ├── contexts/          # Zustand 状态仓库（主控 Tabs、Git 状态等）
│   ├── pages/             # 视图页面
│   │   ├── ProjectsPage   # 项目管理
│   │   ├── AccountsPage   # 凭据管理
│   │   ├── SystemsPage    # 部署系统拓扑
│   │   ├── SSHPage        # SSH & SFTP 与隧道总控
│   │   ├── ChatPage       # AI 助手终端
│   │   └── Workspace      # IDE 工作空间（包含核心 CodeEditor、Diff 标签页）
│   ├── utils/             # 图标解析等辅助函数
│   └── types/             # 全局 TypeScript 接口声明
├── index.html
├── package.json
└── tsconfig.json
```

---

## 📝 贡献与许可

FileClaw 采用商业与学术友好许可，相关安全密钥均由应用沙箱加密存储至您的本地目录，绝不上发至外部服务器。欢迎提 Issue 与 Pull Request 共同完善功能！
