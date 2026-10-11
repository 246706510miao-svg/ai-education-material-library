# AxisVerse 高数教学演示

代码位于 AxisVerse 目录。Windows 需 Node.js 24、pnpm 11 和 Python 3.12+；首次启动需要联网安装依赖和构建。

```powershell
git clone https://github.com/246706510miao-svg/ai-education-material-library.git
cd ai-education-material-library/AxisVerse
Copy-Item .env.example .env
# 填写 DEEPSEEK_API_KEY 与 AXISVERSE_MCP_KEY
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/axisverse.ps1
```

打开启动日志给出的完整本机登录地址。详见 [启动与高数演示](AxisVerse/启动与高数演示.md)；录制旁白见 [比赛演示视频文稿](比赛演示视频文稿.md)。密钥、教材原件及会话记录不随源码发布。
