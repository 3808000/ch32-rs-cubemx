// CH32H417 V3F（启动核）link.x 链接脚本（highcode 全速运行）
export const H417_V3F_LINK_X = `/*
 * V3F 启动核链接脚本：整个程序在零等待共享 SRAM 中运行。
 *
 * 取自 qingke-rt 的 link-highcode.x，唯一差异是 .text/.rodata 折进 .highcode：
 * hart0 没有指令 cache，从 Code FLASH 取指约 2.6 MIPS，而从共享 SRAM 执行约 1 IPC。
 * 留在 flash 的只有拷贝建立前就要运行的 .init 与 .handle_reset。
 */
INCLUDE memory.x
INCLUDE device.x

PROVIDE(_stext = ORIGIN(REGION_TEXT));
PROVIDE(_stack_start = ORIGIN(REGION_STACK) + LENGTH(REGION_STACK));
PROVIDE(_max_hart_id = 0);
PROVIDE(_hart_stack_size = 2K);
PROVIDE(_heap_size = 0);

/* 异常处理 */
PROVIDE(InstructionMisaligned = ExceptionHandler);
PROVIDE(InstructionFault = ExceptionHandler);
PROVIDE(IllegalInstruction = ExceptionHandler);
PROVIDE(Breakpoint = ExceptionHandler);
PROVIDE(LoadMisaligned = ExceptionHandler);
PROVIDE(LoadFault = ExceptionHandler);
PROVIDE(StoreMisaligned = ExceptionHandler);
PROVIDE(StoreFault = ExceptionHandler);
PROVIDE(UserEnvCall = ExceptionHandler);
PROVIDE(MachineEnvCall = ExceptionHandler);

/* 内核中断 */
PROVIDE(NonMaskableInt = DefaultHandler);
PROVIDE(SysTick = DefaultHandler);
PROVIDE(Software = DefaultHandler);

PROVIDE(Exception = _exception_handler);

PROVIDE(DefaultHandler = DefaultInterruptHandler);
PROVIDE(ExceptionHandler = DefaultExceptionHandler);

EXTERN(__CORE_INTERRUPTS);
EXTERN(__EXTERNAL_INTERRUPTS);

ENTRY(_start)

SECTIONS
{
    .init :
    {
        . = ALIGN(4);
        KEEP(*(SORT_NONE(.init)))
        . = ALIGN(4);
    } >FLASH AT>FLASH

    /* 启动时从 flash 拷到 RAM，之后在 RAM 执行 */
    .highcode : ALIGN(4)
    {
        _highcode_lma = LOADADDR(.highcode);
        PROVIDE(_highcode_vma_start = .);
        LONG(_start);
        KEEP(*(.vector_table.core_interrupts));
        KEEP(*(.vector_table.external_interrupts));
        KEEP(*(.vector_table.exceptions));
        *(.trap .trap.rust)
        *(.highcode);
        *(.highcode.*);
        *(.text .text.*)
        *(.gnu.linkonce.t.*)
        *(.rodata .rodata.*);
        *(.srodata .srodata.*);
        . = ALIGN(4);
        PROVIDE(_highcode_vma_end = .);
    } >RAM AT>FLASH

    /* 拷贝建立前运行的代码，留在 flash */
    .text : ALIGN(4)
    {
        . = ALIGN(4);
        KEEP(*(SORT_NONE(.handle_reset)))
        *(.init.rust)
    } >FLASH AT>FLASH

    .data : ALIGN(4)
    {
        _data_lma = LOADADDR(.data);
        PROVIDE(_data_vma = .);
        PROVIDE( __global_pointer$ = . + 0x800 );
        *(.sdata .sdata.* .sdata2 .sdata2.*);
        *(.data .data.*);
        . = ALIGN(4);
        PROVIDE( _edata = .);
    } >RAM AT>FLASH

    .bss (NOLOAD) : ALIGN(4)
    {
        PROVIDE( _sbss = .);
        *(.sbss .sbss.* .bss .bss.*);
        PROVIDE( _ebss = .);
    } >RAM

    .uninit (NOLOAD) : ALIGN(4)
    {
        *(.uninit .uninit.*);
    } >RAM

    . = ALIGN(4);

    PROVIDE(__sheap = .);
    PROVIDE(_stack_end = .);

    .got (INFO) :
    {
        KEEP(*(.got .got.*));
    }

    .eh_frame (INFO) : { KEEP(*(.eh_frame)) }
    .eh_frame_hdr (INFO) : { *(.eh_frame_hdr) }
}

INCLUDE assert-align.x
`
