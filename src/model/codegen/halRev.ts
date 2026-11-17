// 锁定的 ch32-hal commit（见 docs/HAL_API_NOTES.md）。
// 升级 HAL 时同步更新此处并重新核对 API。
export const HAL_REV = 'a0863ebcc1082f64e508b73d3b944f119b0db77b'
export const HAL_GIT = 'https://github.com/ch32-rs/ch32-hal.git'

// 锁定的 ch58x-hal commit（M11，见 docs/CH58X_BACKEND_CONTRACT.md 与 HAL_API_NOTES §13）。
// ch58x-hal 无逐芯片 feature（CH581/582/583 共用），edition 2021，qingke-rt 必须 0.5.x。
export const CH58X_HAL_REV = '611954e40cc4a562f0c4756ab4c0a935af6158df'
export const CH58X_HAL_GIT = 'https://github.com/ch32-rs/ch58x-hal.git'