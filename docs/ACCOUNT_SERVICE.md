# 账号与数据服务运行手册

## 当前边界

代码采用 Express 5 + mysql2 + MySQL，用户已提供云环境 `prod-d5g0ea4ci0a964b1a`。既往初始迁移日志不能代替本次数据库结构独立回读或账号功能验收。独立账号只用用户名＋密码，不发送短信；未接入对象存储、邮件服务或公开排行。

客户端 `miniprogram/config/service.js` 只包含公开环境/服务路由；当前环境及用户截图确认的服务名 `express-7wuk` 已填写，`enabled:false`。不得仅因环境已开通就打开登录开关。云托管控制台自动访问受限，本轮没有绕过访问或修改资源。

## 登录与数据流程

1. 游客可浏览、连接和使用 BLE；新训练只在当前运行内存中显示，不保存草稿或记录、不请求账号数据库；账号功能非强制。主动勾选账号说明并完成微信平台隐私授权后登录。
2. 微信登录调用 wx.login，服务端向 jscode2session 核验，建立自有随机会话；不能信任客户端 userId、OpenID 或传入的 X-WX 身份头。
3. 独立账号注册只需用户名与密码，无需微信身份、手机号或短信。用户名以字母开头，6–24 位字母/数字/下划线，大小写不敏感；重复用户名拒绝，不与微信账号自动合并。微信手机号快捷注册仍是可选路径，需主动授权微信身份与号码。
4. 独立账号已有密码修改需原密码；忘记密码不能仅凭用户名自助重置，须联系运营方核验身份。微信账号绑定手机号、设密与原生授权重置是单独路径。密码 10–64 位含字母数字、无空格；改密撤销所有旧会话，返回新会话。
5. 当前账号记录在本机先保存，点击同步后才上传待同步的已核对 BLE 记录；只有旧版已保存游客记录可确认归属后显式导入，源记录保留，新游客单次结果不参与导入。下载缓存不会自动重新上传。游标分页不保证多设备并发期间的事务快照，新到记录可下次同步获取。
6. 本机删除、云端全量记录删除、账号注销明确区分并二次确认。注销删除账号并级联删除其会话/记录及当前设备缓存，不远程擦除其他设备缓存。备份恢复时仍须执行删除抑制和权利请求处理，不能让已注销资料重新可见。

会话有效 7 天；服务端只保存随机 token 的 SHA-256，客户端在微信 storage 保存不透明 token，不放页面 data。密码采用随机盐的 scrypt；身份/号码用带密钥 HMAC 索引，仅保留号码掩码。微信返回完整手机号、OpenID 仅临时用于核验，不存库、不记录日志；session_key 不下发。

## 微信能力前置条件

- [手机号能力说明](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)：应核对当前主体资格，官方文档说明面向非个人、已认证主体；可能计费。未开通时 `WECHAT_PHONE_ENABLED` 保持关闭，不展示可用授权入口。微信登录仍可用。
- 手机号回调 code 与 wx.login code 不同，5 分钟单次有效，不缓存/重放；手机号授权不等同于短信实时在网验证。注册功能需后台开启并实测 `WECHAT_PHONE_ENABLED=true`，本地客户端开关当前仍为 `enabled:false`，不能视作已上线。
- 独立账号不依赖微信手机号或短信；服务端有限流，公网入口仍需网关侧防护、告警与真实联调。
- [登录服务接口](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)
- [云托管调用](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-sdk-api/container/Cloud.callContainer.html)：真实小程序身份和环境权限须在平台确认；浏览器预览不支持。

## 云托管部署步骤（管理员执行）

1. 使用现有服务，不再创建重复付费资源；确认真实服务名称、绑定的小程序和同环境 MySQL 网络。截图中的对象存储不需配置为公读。
2. 使用专用业务数据库 `courtside`（utf8mb4），避免模板的 `nodejs_demo` 或其他业务库。空库可由首次部署显式自动创建；如果已手动建成空库，也可直接自动建表。任何已有业务表或部分迁移都不能被静默接管。迁移账号需对目标库建表及外键权限；若需自动建库，还需服务器级 CREATE DATABASE 权限。运行账号最终仅需目标业务库的读写权限。不开数据库公网地址。
3. 以下变量只通过平台密钥/环境配置注入，不写 Git、不通过聊天发送。现有 `MYSQL_ADDRESS`、`MYSQL_USERNAME` 可直接使用，无需重新映射。已有的 `COS_BUCKET`、`COS_REGION` 保留原值，本服务不使用它们。

| 变量 | 说明 |
| --- | --- |
| WECHAT_APP_ID | `wx84f4e196d257238d` |
| WECHAT_APP_SECRET | 平台密钥，服务端专用 |
| IDENTITY_HMAC_KEY | 32 字节安全随机数的 64 位十六进制编码，须稳定保管；直接更换会使原身份/号码索引失联，需要专门迁移方案 |
| MYSQL_ADDRESS | 保留云平台已有的同环境内网 `主机:端口`；若明确配置 MYSQL_HOST/MYSQL_PORT 则优先使用单独配置 |
| MYSQL_USERNAME | 新建的专用业务用户名，不填数据库名；若配置 MYSQL_USER 则优先使用它 |
| MYSQL_PASSWORD | 与上述业务用户名对应的密码，只填写在控制台 |
| MYSQL_DATABASE | `courtside`，不是 `nodejs_demo` |
| MYSQL_MIGRATION_USER / MYSQL_MIGRATION_PASSWORD | 可选，成对配置独立的建库建表账号；自动迁移时使用它，服务日常仍使用 MYSQL_USERNAME/MYSQL_PASSWORD |
| DB_AUTO_MIGRATE | 首次部署设 `true`，启动前检查并应用受控初始建表；默认 `false`，未设置不会建表 |
| DB_CREATE_DATABASE | 仅当目标库尚不存在、明确要自动建库时首次设 `true`；默认 `false`，需要上述账号具有建库权限 |
| MYSQL_TLS_CA | 可选证书内容，启用时验证服务端；若用无 TLS 内网须按平台网络与风险要求确认 |
| WECHAT_PHONE_ENABLED | 首次填 `false`；只有资格、配额、隐私声明和接口实测完成才设 `true` |
| USERNAME_AUTH_ENABLED | 默认 `false`；002 迁移、独立回读、隐私声明与真实联调后才设 `true` |
| DB_ALLOW_USERNAME_MIGRATION | 默认 `false`；备份并核对 001 历史/表结构及维护窗口后单次显式设 `true` 执行 002 |
| 容器端口 | 根据用户调整的服务配置，代码固定监听 8080；已有 PORT 环境变量不改变监听端口 |

4. 用户不必粘贴 SQL：首次部署设置 `DB_AUTO_MIGRATE=true`，容器启动时先在目标库获取迁移锁，校验脚本 SHA-256 与版本记录，再运行仓库内受控 `001_initial.sql`，建四张业务表和一张迁移历史表，通过结构检查后才监听端口。数据库不存在时，只有 `DB_CREATE_DATABASE=true` 才创建指定的 `courtside`，绝不触碰 `nodejs_demo`。MySQL 5.7 的 DDL 不可事务回滚：失败留下 `running` 记录，下一次启动拒绝盲目重放，需先检查实际状态。已有未纳入版本记录的表也拒绝自动接管。若需单次维护部署，可在相同内网配置下执行 `npm run migrate`；这不是已配置的外部 CI 步骤。
5. 初始化经独立回读成功后，关闭 `DB_CREATE_DATABASE`、`DB_AUTO_MIGRATE`，按权限规划撤掉运行账号的 DDL 权限或使用独立迁移账号。独立账号需要 `002_username_auth.sql`：允许 `users.wechat_key` 为空，新增用户名与唯一索引。普通启动/迁移默认延期 002；先备份和确认影响/维护窗口，使用独立迁移账号显式 `DB_ALLOW_USERNAME_MIGRATION=true` 执行一次 `npm run migrate` 并独立回读。MySQL 5.7 的 ALTER 不可事务回滚；失败时历史记录保留 `running`，必须人工核查，禁止盲重试。未完成前 `USERNAME_AUTH_ENABLED=false`。
6. 从仓库根目录、根 `Dockerfile` 构建后端；或以 `server/` 为构建上下文使用其中 Dockerfile，二选一。根镜像仅复制后端及锁文件，不复制小程序、设计源图、测试、环境文件或 Git。使用 Node 22、非 root 用户，容器端口 8080。旧模板 `container.config.json` 仅首次创建有效，现已移除，不能拿它宣称已修改线上设置。
7. 配置就绪探针 `/readyz`，存活探针 `/healthz`。readyz 检查表结构，但不证明全部索引、权限及业务可用。冷启动/数据库暂停可能超出客户端超时；合理设置最小实例、预热、健康探针和备份，涉及费用由管理员确认。客户端 1400ms 超时不重试写操作，真实链路须测量；超时提示结果不确定，先重新登录/同步核对。
8. 核对数据库备份、保留期限、删除后备份处理、配额、数据库和入口访问控制、API 访问限制、报警。限流由 MySQL 多实例共享，但公网入口仍需网关限流/防护。日志不能记录密码、手机号、请求体、Authorization 或含 AppSecret/token 的上游 URL。
9. 配置正式隐私指引、真实运营主体和联系渠道，包含账号、手机号、密码摘要、会话、云端记录、缓存隔离与删除范围。确认后将客户端 enabled 打开，用真机联调。

## API 概览

除 healthz/readyz、配置和认证接口，均需 `Authorization: Bearer <业务会话>`；认证要求 `consentVersion=2026-10-26-account-v3`。不要把真实凭证放进示例。

| 方法与路径 | 用途 |
| --- | --- |
| GET /v1/config | 微信手机号、独立账号能力及说明版本 |
| POST /v1/auth/wechat | code 换业务会话 |
| POST /v1/auth/register | 微信登录 + 原生手机号双重核验后注册 |
| POST /v1/auth/password | 已绑定号码与密码登录 |
| POST /v1/auth/username/register · /v1/auth/username | 独立用户名密码注册/登录；不自动合并账号 |
| GET /v1/me · PATCH /v1/me | 资料查询/昵称更正 |
| POST /v1/account/phone | 原生授权 code 绑定手机号 |
| PUT /v1/account/password | 设置或原密码修改 |
| POST /v1/account/password/reset | 近期微信身份 + 绑定号码授权重置 |
| POST /v1/auth/logout | 撤销本会话 |
| GET /v1/records | 每页 100，使用 nextCursor 继续；按 endedAt/id 排序 |
| PUT /v1/records/:id | 按用户+ID 幂等保存，内容不同则冲突 |
| DELETE /v1/records | confirm=DELETE_RECORDS，全量删除当前账号记录 |
| DELETE /v1/account | confirm=DELETE_ACCOUNT，近期微信或独立账号登录后注销 |

## 真实联调与放行条件

- 新数据库迁移/readyz，最小权限、utf8mb4、JSON、索引及并发事务验证（MySQL 5.7 不能只靠测试替身判定兼容）。
- 首次微信登录、拒绝隐私、错误 code、手机号资格/拒绝/绑定冲突；不把本机昵称当身份。
- 用户名冲突与大小写、注册/登录/改密/注销、人工身份核验及网关防暴力尝试；002 迁移的真实 MySQL 5.7 结构与维护窗口核对。
- 绑定→设密码→退出→密码登录→原密码修改→旧会话失效→微信重置；确认新旧密码行为。
- 两账号隔离、游客导入确认、双设备同步、断网/冷启动/重复提交、结果不确定后只核对不盲重放。
- 使用专门验收账号验证云端删除与注销，不删除用户真实资料，不操作硬件；后台回读匹配用户/记录。
- 手机小屏、大字体、浅深色、原生授权弹窗切后台，草稿与训练安全均不回退。

离线测试不是上述实测证据。上传开发版、推送 Git、部署容器、建库、改变费用配置和正式发布需分别确认范围。
