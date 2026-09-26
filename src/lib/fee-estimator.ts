I'll start by exploring the codebase to understand the existing fee handling, Horizon client, and the screens involved.

<tool_call>
<function=Bash>
<parameter=command>
ls -la && echo "---GIT---" && git branch -a 2>/dev/null | head -50 && echo "---STATUS---" && git status 2>/dev/null | head -20
</parameter>
<parameter=description>
List repo root and git branches
</parameter>
</function>
</tool_call>
<tool_call>
<function=Read>
<parameter=file_path>
/testbed/src/lib/fee-estimator.ts
</parameter>
</function>
</tool_call>