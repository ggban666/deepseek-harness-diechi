"""
微信机器人桥接脚本（wxautox4 / 微信 4.x）。
与宿主插件通过 stdio JSON 行通信：
  stdout  ← 事件：{"type":"status"|"message"|"sent"|"error", ...}
  stdin   → 命令：{"cmd":"send","who":"...","text":"..."}

部署：pip install wxautox4
依赖：电脑微信 4.x 客户端已登录（自动登录则重启不重扫）。
"""
import json
import sys

try:
    from wxautox4 import WeChat
except Exception as exc:  # pragma: no cover
    sys.stdout.write(json.dumps({
        "type": "status", "status": "error",
        "error": f"wxautox4 未安装或不可用: {exc}（请先 pip install wxautox4）",
    }, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.exit(1)


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def on_message(msg, chat):
    try:
        # wxauto 消息类型：1=文本；其它（图片/语音/文件）暂不处理。
        if getattr(msg, "type", 1) != 1:
            return
        content = getattr(msg, "content", "") or ""
        if isinstance(content, str):
            content = content.strip()
        else:
            return
        if content == "":
            return
        emit({
            "type": "message",
            "chat": getattr(chat, "chat_name", "") or "",
            "sender": getattr(msg, "sender", "") or "",
            "content": content[:2000],
        })
    except Exception as exc:  # 回调异常不影响监听
        emit({"type": "error", "text": f"on_message: {exc}"})


def main():
    try:
        wx = WeChat()
        emit({"type": "status", "status": "connected", "account": ""})
    except Exception as exc:
        emit({"type": "status", "status": "error", "error": f"WeChat() 初始化失败（微信客户端是否已登录？）: {exc}"})
        return

    # 监听所有已打开的会话窗口。
    try:
        for chat in wx.GetAllSubWindow():
            name = getattr(chat, "chat_name", "") or ""
            if name == "":
                continue
            try:
                wx.AddListenChat(who=name, callback=on_message)
            except Exception as exc:
                emit({"type": "error", "text": f"AddListenChat({name}): {exc}"})
    except Exception as exc:
        emit({"type": "error", "text": f"GetAllSubWindow: {exc}"})

    # 命令循环：宿主写入 {"cmd":"send",...} 时把消息发到对应会话。
    for line in sys.stdin:
        line = line.strip()
        if line == "":
            continue
        try:
            cmd = json.loads(line)
        except Exception:
            continue
        if cmd.get("cmd") != "send":
            continue
        who = str(cmd.get("who", "") or "")
        text = str(cmd.get("text", "") or "")
        if who == "" or text == "":
            continue
        try:
            wx.SendMsg(msg=text, who=who)
            emit({"type": "sent", "who": who, "ok": True})
        except Exception as exc:
            emit({"type": "error", "text": f"SendMsg({who}): {exc}"})


if __name__ == "__main__":
    main()
