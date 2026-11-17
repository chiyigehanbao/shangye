# 用 Cloudflare 部署 FlowDesk

> 结论：**Cloudflare 可以免费帮你做域名、HTTPS、CDN 和 Tunnel，但不能在免费额度里直接跑这套 FastAPI + SQLite 应用。**
>
> 最快的方式是：**应用跑在你的电脑或一台 VPS 上，Cloudflare Tunnel 把它安全地暴露到你的域名。**

---

## 1. Cloudflare 各产品能不能用？

| 产品 | 能否承载 FlowDesk | 说明 |
| --- | --- | --- |
| DNS | ✅ 可以 | 你已经有域名在 Cloudflare，直接加解析即可 |
| Tunnel | ✅ 可以 | 免费，不需要公网 IP、不需要开 80/443 |
| CDN / WAF | ✅ 可以 | 免费代理、HTTPS、基础防护 |
| Access | ✅ 可选 | 可以给 `/admin` 或整站加邮箱验证 |
| Pages | ⚠️ 只能放静态页 | 落地页可以，但工作台需要 FastAPI |
| Workers | ❌ 不适合 | 不能直接跑 pandas / pypdf / python-docx / 本地 SQLite |
| D1 | ❌ 需要重写 | 不是把 SQLite 文件传上去就能用 |
| Containers | ⚠️ 不推荐 | 不是免费方案，也不适合把 SQLite 当持久盘 |

**所以：Cloudflare 负责“门”，应用还是要跑在一台机器上。**

---

## 2. 方案 A：家里电脑 + Cloudflare Tunnel（最快，面试推荐）

适合：面试前一两天，想用最低成本得到一个可访问的 HTTPS 链接。

代价：电脑不能关机/睡眠，网络不能断。

### 2.1 安装 cloudflared

Windows PowerShell：

```powershell
winget install --id Cloudflare.cloudflared
```

安装后重开终端，确认：

```powershell
cloudflared --version
```

### 2.2 登录并创建 Tunnel

```powershell
cloudflared tunnel login
cloudflared tunnel create flowdesk
```

登录会打开浏览器，选择你的域名。创建成功后会得到一个 UUID，例如：

```text
Created tunnel flowdesk with id 12345678-abcd-...
```

记下这个 UUID，下一步要用。

### 2.3 给域名加一条 Tunnel 解析

把 `app.example.com` 换成你的域名：

```powershell
cloudflared tunnel route dns flowdesk app.example.com
```

### 2.4 写 Tunnel 配置

创建 `C:\Users\<你的用户名>\.cloudflared\config.yml`：

```yaml
tunnel: 12345678-abcd-你的UUID
credentials-file: C:\Users\<你的用户名>\.cloudflared\12345678-abcd-你的UUID.json

ingress:
  - hostname: app.example.com
    service: http://127.0.0.1:8077
  - service: http_status:404
```

注意：

- `service` 指向本机 `8077`，不是公网 IP；
- 不要写成 `https://`，Tunnel 到本机这一段用 HTTP；
- 最后一行 `http_status:404` 必须有。

### 2.5 用公网模式启动应用

在 `D:\XiangMu\shangye\saas` 下：

```powershell
$env:APP_URL="https://app.example.com"
$env:ENV="production"
$env:COOKIE_SECURE="1"
$env:SEED_DEMO="1"
$env:AI_MODE="auto"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8077 --workers 1 --proxy-headers --forwarded-allow-ips="127.0.0.1,::1"
```

或者直接使用仓库脚本：

```powershell
.\scripts\run-public.ps1
```

> 运行前先把脚本里的 `APP_URL` 示例改成你的域名，或先设置环境变量。

### 2.6 启动 Tunnel

另开一个 PowerShell：

```powershell
cloudflared tunnel run flowdesk
```

然后访问：

```text
https://app.example.com
```

### 2.7 让它开机自启（可选）

Windows 可以用“任务计划程序”在登录时启动：

```text
程序：cloudflared
参数：tunnel run flowdesk
```

应用本身也可以做成计划任务。面试演示前手动启动一次更可控。

---

## 3. 方案 B：免费/低价 VPS + Docker + Tunnel（更稳）

适合：希望 24/7 在线，不依赖家里电脑。

### 3.1 机器选择

- Oracle Cloud Always Free（ARM 4C24G 很香，但热门区域经常没库存）
- 其他 1C1G / 2C2G 低价 VPS（面试期间最省心）
- 不建议用免费 PaaS 的临时磁盘跑 SQLite：重启可能丢数据

### 3.2 启动应用

把 `saas/` 传到服务器后：

```bash
cd saas
cp .env.example .env
nano .env
```

至少改：

```dotenv
ENV=production
APP_URL=https://app.example.com
COOKIE_SECURE=1
ADMIN_PASSWORD=换成一个强密码
SEED_DEMO=1
AI_MODE=rules
```

如果暂时没有 AI Key，`AI_MODE=rules` 最稳；有 Key 再改 `auto`。

然后：

```bash
docker compose up -d --build
curl http://127.0.0.1/api/health
```

此时 Nginx 只监听本机/服务器的 80 端口。**不需要把 80/443 暴露到公网**，用 Tunnel 更安全。

### 3.3 在服务器上装 cloudflared

以 Debian/Ubuntu 为例，按 Cloudflare 官方仓库安装，然后：

```bash
cloudflared tunnel login
cloudflared tunnel create flowdesk
cloudflared tunnel route dns flowdesk app.example.com
```

配置 `~/.cloudflared/config.yml`：

```yaml
tunnel: 你的UUID
credentials-file: /root/.cloudflared/你的UUID.json

ingress:
  - hostname: app.example.com
    service: http://127.0.0.1:80
  - service: http_status:404
```

启动并设为服务：

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

### 3.4 防火墙

如果只用 Tunnel，入站只需要 SSH：

```bash
sudo ufw allow 22/tcp
sudo ufw enable
```

不要开 80/443 也可以。Tunnel 是出站连接。

---

## 4. Cloudflare 面板建议

1. **SSL/TLS**：使用 Tunnel 时 Cloudflare 自动处理边缘证书；如果改为 A 记录直连源站，用 `Full (strict)` 并给源站配证书。
2. **Always Use HTTPS**：开启。
3. **Automatic HTTPS Rewrites**：开启。
4. **Bot Fight Mode**：可开，演示站够用。
5. **Access（可选）**：给 `app.example.com/admin` 或整站加邮箱验证，避免平台后台被随意访问。
6. **缓存**：HTML 不要长缓存；`/static/` 可以缓存。当前应用已用 `?v=` 版本参数。

---

## 5. 免费额度下的限制

- Cloudflare 免费代理单次上传上限约 **100MB**；项目限制是 **15MB**，没问题。
- 免费代理请求超时约 **100 秒**；AI 超时配置是 **45 秒**，没问题。
- Tunnel 免费，但没有 SLA；家里电脑睡眠/断网，站点就下线。
- SQLite 只能单实例写入；**不要开多个 uvicorn worker，也不要水平扩多个容器**。
- Cloudflare 不会备份你的 SQLite；仍需 `scripts/backup.sh` 或定时复制 `data/`。
- 公开演示站请改 `ADMIN_PASSWORD`；`SEED_DEMO=1` 时演示账号是公开的，这是预期行为。

---

## 6. 面试前的检查清单

- [ ] `https://app.example.com/api/health` 返回 200
- [ ] 落地页、登录页正常
- [ ] 演示账号能登录
- [ ] Excel 上传、文档抽取、销售看板各跑一次
- [ ] 浏览器地址栏是 HTTPS，Cookie 正常
- [ ] 平台后台密码已改
- [ ] 电脑已设置“不睡眠”
- [ ] 手机 4G 网络也能打开（验证不是只在本机可访问）
- [ ] 准备一个备用方案：本地 `http://127.0.0.1:8077` + 录屏

---

## 7. 一句话总结

> **Cloudflare 不是这台 FastAPI 应用的托管服务器，但它可以免费把“家里电脑或 VPS 上的应用”变成一个 HTTPS 域名。**
>
> 面试最省事的组合：**本机跑 FlowDesk + Cloudflare Tunnel + 你的域名**。
