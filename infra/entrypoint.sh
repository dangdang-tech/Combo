#!/bin/sh
# 单一 Authoring API 进程入口。
set -eu
exec node apps/authoring/dist/processes/api.js
