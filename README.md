# cf-proxy-panel

Cloudflare Workers 上的节点管理面板。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vpslog/cf-proxy-panel)

`cf-proxy-panel` 用 Cloudflare Workers + KV 提供一个轻量的代理节点管理面板，适合管理自建节点、自动接收一键安装脚本生成的 Reality 节点，并快速导出给 Clash 或 V2Ray 客户端使用。

## 核心功能

- **一键安装**：面板内自动生成 Reality 安装命令，复制到 VPS 执行即可完成 Xray Reality 安装。
- **自动推送管理**：安装脚本会把生成的节点自动提交回面板，无需手动复制链接。
- **快速导出**：支持导出 Clash YAML 和 V2Ray base64 合并订阅。
- **访问控制**：通过 `AUTH_TOKEN` 保护管理接口和订阅拉取地址。

## 一键部署

点击上方 **Deploy to Cloudflare** 按钮，按 Cloudflare 引导完成部署。

部署完成后：

1. 打开 Worker 访问地址。
2. 使用部署时配置的 `AUTH_TOKEN` 登录。
3. 复制面板中的 Reality 一键安装命令到 VPS 执行。
4. 安装完成后，节点会自动出现在面板中。
5. 选择 Clash 或 V2Ray，复制合并订阅链接。

## 配置

只需要关注两个配置：

- `AUTH_TOKEN`：面板访问令牌，建议使用足够长的随机字符串。
- `PROXY_STORE`：Cloudflare KV 绑定，用于保存节点数据。

项目已在 `wrangler.toml` 中声明：

```toml
[[kv_namespaces]]
binding = "PROXY_STORE"
```

使用 Cloudflare Workers 的 Deploy 按钮或 Git 部署时，Cloudflare 会根据 Wrangler 配置处理资源创建与绑定。如果控制台提示 KV 绑定缺失，请在 Cloudflare Dashboard 中创建 KV namespace，并绑定变量名 `PROXY_STORE`。


## 项目

- GitHub: [vpslog/cf-proxy-panel](https://github.com/vpslog/cf-proxy-panel)
- Powered by Cloudflare Workers

cf-proxy-panel by vpslog
