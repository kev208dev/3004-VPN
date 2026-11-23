"""CLI entrypoint (`3004-vpn`) for 삼천포(3004) VPN nodes."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

from .node_manager import VPNNodeManager


def _fmt_bytes(num: int) -> str:
    val = float(num)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if val < 1024:
            return f"{int(val)}B" if unit == "B" else f"{val:.1f}{unit}"
        val /= 1024
    return f"{val:.1f}PiB"


def main() -> None:
    if os.geteuid() != 0:
        sys.exit("오류: root 권한(sudo)으로 실행해 주세요. 예: sudo 3004-vpn list")

    parser = argparse.ArgumentParser(
        prog="3004-vpn",
        description="삼천포(3004) VPN — Multi-Node WireGuard Manager",
    )
    parser.add_argument("--json", action="store_true", help="웹 API 연동용 JSON 포맷으로 출력")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="등록된 기기 목록 및 실시간 연결/트래픽 조회")

    p_add = sub.add_parser("add", help="새 기기 자동 등록 및 .conf 설정 발급")
    p_add.add_argument("name", help="기기 이름 (영문/숫자/-/_ 2~32자, 예: laptop2, iphone)")
    p_add.add_argument(
        "--mode",
        choices=["full", "split"],
        default="full",
        help="full: 전체 트래픽 VPN 우회 (기본값) | split: 내부 서버 관리 전용",
    )
    p_add.add_argument("--qr", action="store_true", help="스마트폰 등록용 QR코드 함께 출력")

    p_dis = sub.add_parser("disable", help="기기를 삭제하지 않고 연결만 일시 정지")
    p_dis.add_argument("name")

    p_ena = sub.add_parser("enable", help="일시 정지된 기기 다시 허용")
    p_ena.add_argument("name")

    p_ren = sub.add_parser("rename", help="기기 표시 이름 변경")
    p_ren.add_argument("old_name")
    p_ren.add_argument("new_name")

    p_rm = sub.add_parser("remove", help="기기 영구 삭제 및 VPN IP 회수")
    p_rm.add_argument("name")

    args = parser.parse_args()
    mgr = VPNNodeManager()

    try:
        if args.cmd == "list":
            peers = mgr.list_peers()
            if args.json:
                print(json.dumps({"node": mgr.node, "peers": peers}, indent=2, ensure_ascii=False))
                return
            print(
                f"Node: {mgr.node['node_name']} [{mgr.node['region']}] "
                f"| Endpoint: {mgr.node['endpoint']} | Subnet: {mgr.node['subnet']}"
            )
            print(f"{'NAME':<18} {'VPN IP':<14} {'STATE':<10} {'HANDSHAKE':<13} {'RX / TX'}")
            print("-" * 74)
            for p in peers:
                state = "DISABLED" if not p["enabled"] else ("ONLINE" if p["online"] else "OFFLINE")
                hs = f"{p['handshake_ago_sec']}s ago" if p["handshake_ago_sec"] is not None else "never"
                traffic = f"{_fmt_bytes(p['rx_bytes'])} / {_fmt_bytes(p['tx_bytes'])}"
                print(f"{p['name']:<18} {p['ip']:<14} {state:<10} {hs:<13} {traffic}")

        elif args.cmd == "add":
            res = mgr.add_peer(args.name, mode=args.mode)
            if args.json:
                print(json.dumps(res, indent=2, ensure_ascii=False))
                return
            if args.qr and shutil.which("qrencode"):
                subprocess.run(["qrencode", "-t", "ansiutf8"], input=res["config"], text=True, check=True)
            print(res["config"], end="")

        elif args.cmd in ("disable", "enable"):
            res = mgr.set_peer_enabled(args.name, enabled=(args.cmd == "enable"))
            if args.json:
                print(json.dumps(res, ensure_ascii=False))
            else:
                label = "활성화됨(ENABLED)" if res["enabled"] else "일시차단됨(DISABLED)"
                print(f"{res['name']} ({res['ip']}) -> {label}")

        elif args.cmd == "rename":
            res = mgr.rename_peer(args.old_name, args.new_name)
            print(json.dumps(res, ensure_ascii=False) if args.json else f"{res['old_name']} -> {res['new_name']} ({res['ip']})")

        elif args.cmd == "remove":
            res = mgr.remove_peer(args.name)
            print(json.dumps(res, ensure_ascii=False) if args.json else f"삭제 완료: {res['name']} ({res['ip']})")

    except (ValueError, KeyError, RuntimeError) as exc:
        if args.json:
            print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        else:
            print(f"오류: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
