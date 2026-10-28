# 自动加入 miao-org 与成员团队

独立页面 `/join/`（首页 Join us 入口）→ 填写 GitHub 已验证邮箱 → Turnstile 验证 → Worker 调用
`POST /orgs/miao-org/invitations` → GitHub 发送官方邀请邮件 → 用户接受邀请后
成为普通成员，并自动加入成员团队（ID `20310971`）。团队通过固定 ID 指定，
显示名称与 slug 的变化不需要修改邀请请求。

服务端固定组织、团队和 `direct_member` 权限，客户端无法指定管理员权限或其他团队。
GitHub Pages 继续托管静态网站，凭据仅保存在 Cloudflare Worker 的 Secret 中。
不需要 SMTP、邮件服务或定时扫描成员。

## 首次部署

1. 在 GitHub 为 miao-org 创建专用的 fine-grained personal access token：
   Resource owner 选择 **miao-org**，组织权限 **Members: Read and write**。
   无需授予仓库内容写权限。由组织所有者创建，完成组织要求的审批。
   当前部署按所有者要求使用 **No expiration** 的专用令牌。
   也可改用有 Members 写权限的 GitHub App 安装令牌，但需自行实现短期令牌续期。
   仓库默认的 `GITHUB_TOKEN` 不能管理组织成员。
2. 在 Cloudflare Turnstile 创建 **Managed** widget，允许主机名
   `miao-org.github.io`，不要填写协议或路径。将 Site Key 填入
   `worker/wrangler.jsonc` 的 `TURNSTILE_SITE_KEY`；Secret Key 仅配置为下方 Secret。
3. 安装并登录，再配置两个 Secret：

   ```sh
   npm ci
   npx wrangler login
   npx wrangler secret put GITHUB_ORG_TOKEN --config worker/wrangler.jsonc
   npx wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.jsonc
   npm run worker:deploy
   ```

   Secret 通过交互提示输入，不要放到命令参数、提交文件或网页 JavaScript 中。
   也可以使用 Cloudflare 控制台创建 Worker、部署 `worker/index.js`，并在设置中
   添加变量、Secret 及两个 Rate limiting 绑定；配置与 `wrangler.jsonc` 保持一致。
4. 将 Cloudflare 返回的 Worker HTTPS origin（不带路径）填入
   `onboarding-config.json` 的 `apiBaseUrl`。合并到 `main` 后 GitHub Pages 自动发布。
   配置为空或后端缺少 Secret 时，表单保持关闭并显示联系组织的提示。

## 维护与验证

组织或域名更名后，同步更新 Worker 的 `ORG`、`ALLOWED_ORIGIN`、Turnstile
允许的主机名及前端 `apiBaseUrl`，并确认 `TEAM_ID` 仍属于目标组织。
当前 Worker 名称为 `miao-org-onboarding`。更改 Worker 名称会创建独立服务，
需要为该服务重新配置两个 Secret 并部署；仓库中的名称修改不会迁移线上 Secret。
确认新服务的 `/api/config` 可从网站 Origin 访问后，再发布前端配置。

```sh
npm test
npm run worker:check
```

CI 自动运行接口回归测试与 Worker 打包检查。测试使用模拟服务，不发送真实邀请。
上线后应由一名尚未加入组织的真实申请者验证邮件送达与接受后的团队归属。

- 频率限制：每 IP 约 5 次/分钟、每邮箱约 1 次/分钟；邮箱和 IP 仅以 SHA-256
  摘要作为限流 key。Cloudflare Rate Limiting 按边缘位置近似计数，非全局精确配额。
  `namespace_id` 在 Cloudflare 帐户内共享；如已被其他 Worker 使用，应改为独立数字。
- Turnstile 验证在服务端执行，同时核对 hostname、`onboarding` action、单次 token。
- API 仅允许 `https://miao-org.github.io` 的浏览器 Origin。CORS 不是身份验证，
  防滥用依赖 Turnstile、限流和 GitHub 自身配额。
- 邮箱仅用于 GitHub 邀请及摘要限流，不写入仓库、数据库或应用日志。
  失败请求仅输出脱敏的 GitHub 错误分类、原因及请求 ID，便于实时诊断；不记录提交的邮箱、
  验证 token 或凭据。Worker observability 默认关闭，不保留这些应用日志。
  Cloudflare 与 GitHub 仍按各自政策处理请求。
- 重复申请遇到 422 时，最多检查 1000 条待接受邀请，且仅在确认包含目标团队后
  显示“已有邀请”。既有组织成员或其他团队的旧邀请应由组织管理员处理。
- GitHub 邀请一般 7 天过期；被邀请邮箱必须绑定并验证。组织如果要求 2FA，
  申请者接受前须启用。新组织通常每天最多 50 个邀请，满足 GitHub 条件后为 500 个。
- GitHub 返回 `422` + `Over invitation rate limit` 时，接口映射为 `429` 和
  `ORG_INVITATION_LIMIT`，明确提示组织邀请限流。GitHub 未提供该配额的准确恢复时间时，
  不返回虚构的 60 秒重试时间。不要将所有 `422` 都解释为邮箱未验证。
- Token 过期、撤销或权限不足时，接口返回临时不可用，不能把失败当作已发送。
  定期轮换 `GITHUB_ORG_TOKEN`；Turnstile Secret 轮换时同步更新 Worker。
- 暂停入口：将 `apiBaseUrl` 清空并发布。要同时停止所有直接 API 请求，请在
  Cloudflare 撤销 Worker 的 `GITHUB_ORG_TOKEN` 或停用 Worker。

参考：[GitHub 邀请 API](https://docs.github.com/en/rest/orgs/members#create-an-organization-invitation)、
[邀请与配额](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization)、
[Turnstile 服务端验证](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)、
[Cloudflare 限流](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。
