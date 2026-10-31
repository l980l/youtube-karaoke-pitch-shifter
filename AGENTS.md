<!-- obsidian-work-wiki:start -->
## Project AI work wiki

This project uses the Vault configured in `.ai-wiki.yml` as durable operational memory.

In this project, "AI 위키", "프로젝트 위키", and "위키에 저장해줘" mean the local Obsidian Vault configured in `.ai-wiki.yml`. Route those requests to the `obsidian-work-wiki` skill. Use Notion only when the user explicitly asks for Notion or gives a Notion destination.

For every substantive project task, use the `obsidian-work-wiki` skill:

1. Restore only task-relevant project context from the configured Vault before work.
2. After a meaningful outcome, evaluate the five retention filters and maintain the Vault when one applies; do not require the user to request saving.
3. Follow the configured scope and Git policy. Do not modify `raw/`, schema files, unrelated user changes, or remote Git state.
4. Summarize any wiki and Git changes with the task result.

Do not use another project's Vault or supplementary personal knowledge unless the user explicitly asks.
<!-- obsidian-work-wiki:end -->
