# Cloudinary Free + Cloudflare D1 配置

当前代码支持 Cloudinary 存图片、D1 存账户/帖子/评论，不需要开通 R2。原有 D1 表结构保持不变，已经初始化过数据库的用户无需重建或重复执行 SQL。

## 1. 注册 Cloudinary 免费方案

打开 https://cloudinary.com/pricing ，选择 **Image and Video APIs → Free → Sign Up Free**，用邮箱、Google 或 GitHub 注册。官方当前标注无需信用卡，每月 25 credits；存储、流量等共享额度，并非无限容量。可在控制台 Usage 查看用量。

进入 Cloudinary Console 的 **Settings → API keys**，找到同一个 product environment 的三项信息：Cloud name、API key、API secret。复制的是各项的值，不是 `CLOUDINARY_URL` 整行地址。

## 2. 在 Cloudflare 填入三项变量

打开 **Workers & Pages → 你的现有网站项目 → Settings → Variables and Secrets → Add**。Pages 选择 **Production** 环境，逐项添加：

| 变量名（大小写必须一致） | 值来自 Cloudinary | 类型 |
| --- | --- | --- |
| `CLOUDINARY_CLOUD_NAME` | Cloud name | Text / 普通文本 |
| `CLOUDINARY_API_KEY` | API key | Secret / Encrypt |
| `CLOUDINARY_API_SECRET` | API secret | Secret / Encrypt |

Secret 只在 Cloudflare 后台填写，不要放进 GitHub、HTML 或聊天记录。后端签名上传已实现，**不需要创建 unsigned upload preset**，也不需要手动创建图片文件夹。图片会自动使用 `vmate/帖子ID/图片ID` 作为 public ID。

Workers 项目同样在 Settings 的 Variables and Secrets 中添加这些运行时变量；不要只填到构建系统专用的环境变量里。若用 Wrangler CLI 部署 Workers，将 Cloud name 放到配置的 `vars`，API key 和 API secret 分别用 `wrangler secret put ... --config wrangler.worker.jsonc` 写入；不要把 Secret 写入配置文件。

## 3. 保留 D1 绑定

在网站项目 **Settings → Bindings** 中，确认 D1 的变量名为 **`DB`**，指向你之前创建的数据库。

如果从未创建数据库：在 Cloudflare 的 D1 页面创建 `vmate-community`，在它的 Console 执行仓库 `migrations/0001_community.sql` 的内容，再到网站项目绑定为 `DB`。已有这些表时不要再次运行建表 SQL。

没有开通 R2 的账号可以忽略 `PHOTOS` 绑定。新版生产配置不再要求 R2。若先前确实使用过 R2 并已有图片，保留原 `PHOTOS` 绑定及存储桶，旧图片仍从 R2 读取，新图片使用 Cloudinary；本次不会自动搬迁旧图片。

## 4. 重新部署现有网站

Pages Git 集成的设置应为：

- Git 仓库：`bugbbc/VMATE`，生产分支：`main`。
- 构建命令：`npm run build`。
- 构建输出目录：`dist`。
- 根目录：仓库根目录。

保存变量和绑定后，到 **Deployments** 对最新提交重新部署（Retry deployment / Redeploy）。变量不会自动注入已经发布的旧版本。通过 Git 集成构建会自动打包根目录的 `functions/`。

仓库中的 `wrangler.pages.jsonc` 和 `wrangler.worker.jsonc` 是显式使用的 CLI 配置模板，D1 ID 是占位符；使用 Pages 控制台管理 Git 集成时不需要改这些文件。若使用 CLI，则必须先填入真实项目名和 D1 ID。`wrangler.local.jsonc` 只用于本地模拟 D1/R2，不用于线上部署。

## 5. 验证

访问网站 `/community.html`，注册或登录，发布一条带 emoji 和图片的帖子。刷新后检查图片仍在；用另一个浏览器确认可见，再删除测试帖子并确认网站不再展示图片。Cloudinary Media Library 中也应能找到上传的图片，删除操作会请求销毁资源并清理 CDN 缓存，缓存失效可能稍有延迟。

若文字正常但图片失败，先检查三项值是否来自同一个 Cloudinary product environment、是否填在 Production、保存后是否重新部署，再检查 Cloudinary 用量。若全部社区接口不可用，优先检查 `DB` 绑定和数据库是否初始化。

本地测试使用真实 D1/R2 模拟运行时和模拟的 Cloudinary HTTP 服务；真实账号的上传仍需完成以上配置后验证。Pages 删除失败的图片会留在 D1 的 `pending_deletions` 中，后续登录/注册或删除操作重试；Workers 另有每日定时重试。

官方说明：[免费方案](https://cloudinary.com/pricing)、[查找 API 凭据](https://cloudinary.com/documentation/dev_kickstart_acct_setup)、[Cloudflare 变量与密钥](https://developers.cloudflare.com/pages/functions/bindings/)。
