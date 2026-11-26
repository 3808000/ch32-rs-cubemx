"""通过 OpenOCD 向当前 Phase D 固件的 RAM 注入一次性宿主随机种子。"""

import argparse
import os
from pathlib import Path
import secrets
import struct
import subprocess
import tempfile

READY = 0x4D313944


def provision(elf, openocd, config, nm):
    symbols = subprocess.check_output([nm, "--defined-only", elf], text=True)
    mailbox = next(
        int(fields[0], 16)
        for line in symbols.splitlines()
        if len(fields := line.split()) == 3 and fields[-1] == "M19_ENTROPY"
    )
    if not 0x20000000 <= mailbox <= 0x20008000 - 36 or mailbox % 4:
        raise ValueError("M19_ENTROPY 不在 CH582 的对齐 RAM 范围内")
    # /dev/shm 只用作本机 OpenOCD 的临时传递介质。
    with tempfile.TemporaryDirectory(prefix="m19-seed-", dir="/dev/shm") as directory:
        payload = Path(directory) / "entropy.bin"
        with os.fdopen(os.open(payload, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "wb") as stream:
            stream.write(secrets.token_bytes(32))
            stream.write(struct.pack("<I", READY))
        subprocess.run(
            [openocd, "-f", config, "-c",
             f"init; halt; wait_halt 2000; load_image {payload} 0x{mailbox:08x} bin; resume; shutdown"],
            check=True,
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("elf")
    parser.add_argument("--openocd", default="openocd")
    parser.add_argument("--config", required=True)
    parser.add_argument("--nm", default="riscv-none-elf-nm")
    args = parser.parse_args()
    provision(args.elf, args.openocd, args.config, args.nm)


if __name__ == "__main__":
    main()
