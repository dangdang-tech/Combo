# 项目约定

## 目录 README 维护

服务端源码（apps/authoring、当前 V2 apps、packages/shared、Creator packages、db）在相关目录维护 README.md，写清目录职责、文件和上下游关系。改代码时如果新增、删除或移动文件，或改变模块职责与依赖关系，必须同步更新相关 README；只改函数内部实现不用动它。

README 的写法：全中文完整句子，不用箭头链速记（不写「A → B」），术语最多一两个放括号里解释，只写代码现状不写设计动机。
