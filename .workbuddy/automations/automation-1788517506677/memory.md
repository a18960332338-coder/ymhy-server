# 云眠花园源码每日自动备份 - 执行记录

首次执行（无更早记录）。

## 2026-09-05 03:00
- 仓库1（前端+引擎，ymhy-server）：无改动，跳过（NO_CHANGES）
- 仓库2（app.remote.py，ymhy-server-backup）：无改动，跳过（NO_CHANGES）
- 结果：无提交、无推送。两个仓库均无错误。

## 2026-09-06 18:03
- 仓库1（前端+引擎，ymhy-server）：有改动，commit 85df207 "backup 2026-09-06"（新增本 memory.md），push 成功（3074253..85df207）。
- 仓库2（app.remote.py，ymhy-server-backup）：有改动，本地 commit c66fd57 "backup 2026-09-06"（新增本 memory.md），但 push 被 GitHub Push Protection 拒绝（rule violations）：历史提交 0779abf 中含疑似密钥——腾讯云 Secret ID（_cos_probe.py:4、_write_env.py:20）、DeepSeek API Key（app.py:160、app.py.bak_cos:160）、VolcEngine Ark API Key（app.py:165、app.py.bak_cos:165）。按约定未绕过（未 -f、未 allow secret），本地保留 commit。
- 待办：需在仓库2中清除历史提交里的密钥（git filter-repo/改写历史或从这些文件移除硬编码密钥）后，后续 push 才能成功。
- 结果：仓库1 有提交并推送；仓库2 有本地提交但推送失败（密钥扫描拦截）。
