// CH32H417 V5F（从核）memory.x 内存分区
export const H417_V5F_MEMORY_X = `/*
 * CH32H417QEU6（QingKe V5F / 从核）链接内存布局。
 *
 * 与 WCH CSDK 的双核分区一致，两个镜像在 flash 上首尾相接：
 *   V3F : flash 0x00000000 + 64K，RAM = ITCM
 *   V5F : flash 0x00010000 + ...，RAM = DTCM
 *   两者: RAM_SHARED 0x20178000 + 32K 跨核邮箱
 *
 * FLASH ORIGIN 同时是唤醒入口：V3F 把它传给 qingke::pfic::wake_other_core()。
 * DTCM 前 512 字节留给 QingKe V5 的硬件压栈区（与 CSDK 一致）。
 */
MEMORY
{
    FLASH : ORIGIN = 0x00010000, LENGTH = 960K - 64K
    RAM   : ORIGIN = 0x200C0200, LENGTH = 256K - 512
    SRAM_SHARED (rwx) : ORIGIN = 0x20178000, LENGTH = 32K
}

REGION_ALIAS("REGION_TEXT", FLASH);
REGION_ALIAS("REGION_RODATA", FLASH);
REGION_ALIAS("REGION_DATA", RAM);
REGION_ALIAS("REGION_BSS", RAM);
REGION_ALIAS("REGION_HEAP", RAM);
REGION_ALIAS("REGION_STACK", RAM);
`
