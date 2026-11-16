// CH32H417 V3F（启动核）memory.x 内存分区
export const H417_V3F_MEMORY_X = `/*
 * CH32H417QEU6（QingKe V3F / 启动核）链接内存布局。
 *
 *   0x00000000 +  64K  V3F flash 加载槽
 *   0x00010000 + ...   V5F flash（单核模式下不使用）
 *   0x20100000 + 448K  零等待代码/数据/bss（V3F 经 highcode 从这里运行）
 *   0x20170000 +  32K  零等待栈
 *   0x20178000 +  32K  跨核邮箱区
 *
 * 覆盖 ch32-metapac 生成的 memory.x：后者没有 qingke-rt link.x 需要的 `+"`RAM`"+` 区。
 */
MEMORY
{
    CODE   (rx)  : ORIGIN = 0x00000000, LENGTH =  64K
    USR    (rwx) : ORIGIN = 0x08000000, LENGTH =  64K
    SYS    (rwx) : ORIGIN = 0x1FFF0000, LENGTH =   56K
    VND    (r)   : ORIGIN = 0x1FFFF700, LENGTH =   256
    OPT    (rw)  : ORIGIN = 0x1FFFF800, LENGTH =   256
    RAM    (rwx) : ORIGIN = 0x20100000, LENGTH = 448K
    STACK  (rwx) : ORIGIN = 0x20170000, LENGTH =  32K
    ITCM   (rwx) : ORIGIN = 0x200A0000, LENGTH = 128K
    SRAM_SHARED (rwx) : ORIGIN = 0x20178000, LENGTH = 32K
}

REGION_ALIAS("FLASH", CODE);
REGION_ALIAS("REGION_TEXT", CODE);
REGION_ALIAS("REGION_RODATA", CODE);
REGION_ALIAS("REGION_DATA", RAM);
REGION_ALIAS("REGION_BSS", RAM);
REGION_ALIAS("REGION_HEAP", RAM);
REGION_ALIAS("REGION_STACK", STACK);
`
