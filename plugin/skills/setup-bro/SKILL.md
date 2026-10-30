---
name: setup-bro
description: Install, configure, or remove Bro Vibe Coding on this computer or in a project.
disable-model-invocation: true
---

Run `node <absolute path to ../../lifecycle/plugin/install.mjs> --launch --project <absolute current project path>` from the user's current directory. Resolve the installer relative to this installed skill, never from a downloaded bootstrap. Use the host's normal permission flow for launching a terminal or accessing the target directory.

The installer owns the four action choices and both system removal modes, component selection and tool dialogs in the user's terminal. Wait for the command to finish; the user supplies terminal input directly. Do not send answers through stdin or turn these dialogs into chat questions. If launching the terminal is unavailable, show the exact fallback command printed by the launcher. Wait for the user to finish it.

After completion, run the printed verification command. Its temporary location survives plugin removal. A completed report alone is insufficient: verification must pass against the actual resources and native registration. On cancellation, interruption or failure, report the completed steps and error; keep archives and report the printed continuation command for an interrupted system removal. Its executor survives removal of the plugin. For other unfinished actions, suggest rerunning setup-bro.

After successful verification, suggest the next relevant step: reload the agent and call bro in a configured project, configure a project if the user skipped it, reload the agent after full removal, or reload and call setup-bro to perform a fresh installation after a reset. A reset clears configured tools and projects while preserving the existing plugin and marketplace registration without downloading them again. Authentication is confirmed only by a successful operation against the service; configuration presence does not prove it.
