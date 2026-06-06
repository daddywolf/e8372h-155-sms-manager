# HiLink SMS Manager

本地运行的华为 HiLink 短信管理页，默认连接 `http://192.168.7.1`，只监听 `127.0.0.1`。

## 运行

```bash
cd /Users/<user>/sms-manager
npm start
```

打开 `http://127.0.0.1:8787/`，用设备的 Web 管理账号登录。

可选环境变量：

```bash
HILINK_BASE=http://192.168.7.1 PORT=8787 npm start
```

## 已审接口

认证：

- `GET /api/webserver/token`
- `POST /api/user/challenge_login`
- `POST /api/user/authentication_login`
- `POST /api/user/logout`

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
