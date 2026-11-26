"""通过 Linux Bluetooth (BlueZ) 建立 LE ACL 并保持连接，不发送 ATT 请求。"""

import argparse
import select
import socket
import time

ATT_CID = 0x0004
LE_PUBLIC = 1
SOAK_SECONDS = 30 * 60


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", help="Peripheral 的公开蓝牙地址")
    parser.add_argument("--adapter", default="00:00:00:00:00:00", help="本地适配器地址")
    parser.add_argument("--seconds", type=int, default=SOAK_SECONDS, help="持续连接时长")
    args = parser.parse_args()
    if args.seconds <= 0:
        parser.error("--seconds 必须大于 0")

    with socket.socket(socket.AF_BLUETOOTH, socket.SOCK_SEQPACKET, socket.BTPROTO_L2CAP) as link:
        link.settimeout(15)
        link.bind((args.adapter, 0, ATT_CID, LE_PUBLIC))
        link.connect((args.address, 0, ATT_CID, LE_PUBLIC))
        start = time.monotonic()
        print(f"LE ACL 已建立，本地适配器 {link.getsockname()[0]}", flush=True)

        poller = select.poll()
        poller.register(link, select.POLLERR | select.POLLHUP | select.POLLRDHUP)
        while (elapsed := time.monotonic() - start) < args.seconds:
            timeout_ms = max(1, round(1000 * min(args.seconds - elapsed, 60)))
            if poller.poll(timeout_ms):
                error = link.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
                raise SystemExit(f"LE ACL 在 {time.monotonic() - start:.2f} s 断开，SO_ERROR={error}")
            print(f"LE ACL 持续连接 {time.monotonic() - start:.2f} s", flush=True)


if __name__ == "__main__":
    main()
