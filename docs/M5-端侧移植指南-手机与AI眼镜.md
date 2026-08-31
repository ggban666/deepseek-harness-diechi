# M5 端侧移植指南（手机 + AI 眼镜）

> 蝶翅自进化整体技术方案 v1 的 M5。手机=客户端连 PC（A 路线）；
> 眼镜=ESP32-S3 拉流进 8080 会话（阶段一 OpenGlass DIY，$20）。

---

## 一、M5a 手机客户端（浏览器访问 3090）

**原则**：手机只做客户端，浏览器访问 3090 的 Web UI，全功能保留、零改造。

### 1. 同局域网（最简单）
```text
手机连与 PC 同一个 Wi-Fi
PC 侧：3090 监听 0.0.0.0（默认即所有网卡）
手机浏览器打开：http://<PC的局域网IP>:3090
```
- 查 PC 局域网 IP：`ipconfig`（Windows）→ IPv4 地址。
- 3090 是否监听 0.0.0.0：`netstat -ano | findstr :3090`，监听地址应为 `0.0.0.0`。

### 2. 跨网络（Tailscale 穿透，推荐）
```text
PC 和手机都装 Tailscale，登录同一账号
手机浏览器打开：http://<PC的Tailscale虚拟IP>:3090
```
- Tailscale 虚拟 IP 在 PC 上 `tailscale ip -4` 查看。
- 优点：任意地点访问、端到端加密、无需公网端口映射。

### 3. 注意事项
- **音频**：手机浏览器 TTS 播放需在 HTTPS（Tailscale 默认给 HTTPS）或 `http://localhost` 下；
  纯局域网 `http://<IP>` 下部分浏览器会拦麦克风/播放器，优先用 Tailscale 的 HTTPS。
- **摄像头**：`/observe` 推帧依赖 `getUserMedia`，手机浏览器需授权摄像头；HTTPS 必须。
- **性能**：推理在 PC 跑，手机只做展示，电池/性能无压力。

---

## 二、M5b AI 眼镜（ESP32-S3 → 8080 会话）

**本质**：眼镜只是一个新帧源。ESP32 跑 CameraWebServer，把镜头画面推到 PC，
`esp32_bridge.py` 逐帧转 base64 喂给 `/api/v1/vision/session/{sid}/observe`，
用户说话时模型依据连续帧记忆回答。

### 硬件（阶段一 OpenGlass DIY，约 $20）
| 件 | 型号 | 说明 |
| --- | --- | --- |
| 主控 | ESP32-S3 开发板 | 带 OV2640 摄像头（如 ESP32-S3-EYE / AI-Thinker 模组） |
| 镜头 | OV2640 2MP | CameraWebServer 固件原生支持 |
| 供电 | 18650 / USB 充电宝 | 眼镜形态需小电池 |

### 固件
烧录 Arduino `esp32cam` 示例的 `CameraWebServer`，AP 模式默认 IP `192.168.4.1`，
摄像头流在 `http://192.168.4.1:81/stream`（MJPEG）。

### PC 侧接线（本仓库已提供）
```bat
set DSH_HOME=D:\桌面\振翅科技\蝶翅-app\diechi-home
cd /d D:\桌面\振翅科技\蝶翅-app\deploy-tools
set DIECHI_PROXY=http://127.0.0.1:65532

:: 1) 先起 8080 视觉服务（MiniCPM 已加载）
:: 2) 起桥：ESP32 连 PC 同一 Wi-Fi 时指定其 IP
python esp32_bridge.py --esp32 192.168.1.50

:: 无 ESP32 时用本地图片模拟帧源，验证整条链路：
python esp32_bridge.py --sim demo.jpg
```

### 验证标准
```text
桥起来后 8080 日志应看到：
  [bridge] 会话 xxxx 就绪，开始推帧
  [bridge] 已推 20 帧 (frames in session: N)
  [recog] 节流识别一帧 -> captions 时间线增长
然后对会话说话提问，模型能答出"刚才镜头里看到的东西" → 链路通
```

### 阶段二（商业眼镜）
Rokid / RayNeo 等量产眼镜提供更高帧率与 IMU，接入方式相同——
只需把 `_mjpeg_frames` 换成厂商 SDK 的帧回调，observe 接口不变。

---

## 三、M5 主要挑战与对策
| 挑战 | 对策 |
| --- | --- |
| 推理必须在局域网可达的 PC | 手机/眼镜只做帧源与展示，推理全在 3090 |
| 无屏设备 VAD/回声抑制 | 优先按钮/云端 ASR 触发；迭代加本地 VAD |
| 功耗 | ESP32 低功耗模式 + 推帧节流（OBSERVE_INTERVAL 调大） |
| 隐私合规 | 眼镜录制画面在本地处理，默认不出内网 |

---

## 四、文件清单（M5）
- `deploy-tools/esp32_bridge.py` —— 眼镜帧源桥（已实测 observe 链路）
- `docs/蝶翅-自进化整体技术方案-v1.md` —— 总方案
