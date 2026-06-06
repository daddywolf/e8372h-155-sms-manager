# HiLink SMS Manager

本地运行的华为 HiLink 短信管理页，默认连接 `http://192.168.7.1`，只监听 `127.0.0.1`。

## 运行

先编辑 `.env`，写入 HiLink 设备的 Web 管理账号密码：

```bash
HILINK_BASE=http://192.168.7.1
HILINK_USERNAME=admin
HILINK_PASSWORD=your-router-password
PORT=8787
SKIP_USB_MODESWITCH=0
```

```bash
cd /Users/<user>/sms-manager
npm start
```

打开 `http://127.0.0.1:8787/`。页面不再提供应用内账号密码认证，设备登录由服务端使用 `.env` 自动完成；对外访问控制建议交给 Cloudflare Access。

`npm start` 会先执行 `tools/switch_huawei_e8372.sh`，把 Huawei E8372 从安装盘模式切到 HiLink 网卡模式。这个脚本在设备已经是网卡模式或未插入时会自动跳过；如果需要临时跳过，可设置：

```bash
SKIP_USB_MODESWITCH=1 npm start
```

可选环境变量：

```bash
HILINK_BASE=http://192.168.7.1 HILINK_USERNAME=admin HILINK_PASSWORD=your-router-password PORT=8787 npm start
```

## 短信模板

模板已独立为 `templates.js`，内置通知和验证码两类：

- `notification`: `【通知】{{message}}`
- `verification-code`: `您的验证码是 {{code}}，{{ttl}} 分钟内有效。`

可在 `.env` 中覆盖：

```bash
SMS_TEMPLATE_NOTIFICATION=【通知】{{message}}
SMS_TEMPLATE_VERIFICATION_CODE=您的验证码是 {{code}}，{{ttl}} 分钟内有效。
SMS_CODE_TTL=5
```

模板发送接口：

```bash
curl -X POST http://127.0.0.1:8787/api/send-notification \
  -H 'Content-Type: application/json' \
  -d '{"phones":["10086"],"message":"服务已恢复"}'

curl -X POST http://127.0.0.1:8787/api/send-verification-code \
  -H 'Content-Type: application/json' \
  -d '{"phones":["10086"],"code":"123456","ttl":"5"}'
```

## 已审接口

认证：

- `GET /api/webserver/token`
- `POST /api/user/challenge_login`
- `POST /api/user/authentication_login`

短信：

- `GET /api/sms/sms-count`
- `POST /api/sms/sms-list`
- `POST /api/sms/send-sms`
- `POST /api/sms/delete-sms`
- `POST /api/sms/set-read`
- `GET /api/sms/send-status`

短信列表请求体：

```xml
<request>
  <PageIndex>1</PageIndex>
  <ReadCount>20</ReadCount>
  <BoxType>1</BoxType>
  <SortType>0</SortType>
  <Ascending>0</Ascending>
  <UnreadPreferred>0</UnreadPreferred>
</request>
```

发短信请求体：

```xml
<request>
  <Index>-1</Index>
  <Phones><Phone>10086</Phone></Phones>
  <Sca></Sca>
  <Content>hello</Content>
  <Length>5</Length>
  <Reserved>1</Reserved>
  <Date>2026-06-06 12:00:00</Date>
</request>
```

`BoxType` 常用值：

- `1`: 本机收件箱
- `2`: 本机已发送
- `3`: 本机草稿
- `4`: 本机回收站
- `5`: SIM 收件箱
- `6`: SIM 已发送
- `7`: SIM 草稿
- `8`: 混合收件箱
- `9`: 混合已发送
- `10`: 混合草稿

## 认证细节

这台固件使用 SCRAM 登录，但 Huawei 的 `SCRAMJS` 调用 HMAC 的参数顺序和标准 SCRAM 不一致。代理按固件前端脚本的顺序生成 `clientproof`，并复刻了 `__RequestVerificationTokenone` / `__RequestVerificationTokentwo` 的优先级。

这里的认证仅指服务端代理登录 HiLink 设备。Web UI 自身不再处理用户账号密码。
