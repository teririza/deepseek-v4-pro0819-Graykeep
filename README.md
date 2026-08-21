# deepseek-v4-pro0819-Graykeep
dspro0819 Graykeep 是一套围绕 DeepSeek 灰测（canary）会话的本地工具集，首块开源的是固化引擎 graypin：你在 DSH 上"抽中"灰测会话后，运行 graykeep pin 并粘贴该会话的 session-id，工具会自动补齐你的 user-id、定位 settings.yaml、备份后写入带灰测身份头的供应商配置，并做文本级 round-trip 校验，随时可 unpin/rollback。零运行时依赖（Node ≥ 18 即可 clone 即用），不联网、不下模型、只改一个配置块。
