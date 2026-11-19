// 锁定的 ch5xx-hal commit（M17，见 docs/CH5XX_BACKEND_CONTRACT.md D2）。
// 真相源：reference/ch5xx-hal @ 875651b6（tarball 解包，非 git 树）；ch5xx-metapac 由 HAL 自己锁 680e2e12。
// 注意：本文件放在 ch5xx/ 目录内，避免改动 legacy ch58x 的 halRev.ts（历史 cube.json/README 仍引用 CH58X_HAL_REV）。
export const CH5XX_HAL_REV = '875651b693ef437e045d023171adaf052a07525c'
export const CH5XX_HAL_GIT = 'https://github.com/ch32-rs/ch5xx-hal.git'

// embassy git patch 锁定 rev（逐字照 reference/ch5xx-hal/examples/ch582/Cargo.toml）。
export const EMBASSY_GIT_REV = '4e2fa2e3ae7c9fd62a32193f47af12f68df3df7d'
export const EMBASSY_GIT = 'https://github.com/embassy-rs/embassy'