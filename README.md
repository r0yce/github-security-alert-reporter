# GitHub Security Alerts Daily Reporter

This repository hosts a GitHub Actions workflow that automatically generates daily reports of open security scanning alerts across all your GitHub repositories.

It leverages GitHub's GraphQL API (preferred for most alert types) and REST API where necessary (for full secret scanning details) to provide comprehensive, actionable insights.

## 🚀 Features

- **Daily Scheduled Reports**: Runs automatically every day via cron schedule (customizable).
- **Multi-Type Alert Coverage**:
  - Dependabot vulnerability alerts
  - Code scanning (CodeQL) alerts
  - Secret scanning alerts (with paths and types)
- **Rich Report Details**:
  - Alert type, summary, severity, path/location
  - Secret type and available details (value often redacted by GitHub for security)
  - Repository context
  - **Top recent contributor** (name, email, login) from latest commit on default branch
- **Issue-Based Reporting**: Creates a new labeled GitHub Issue each day for easy tracking, searching, and triage.
- **GraphQL-First Design**: Efficient, modern API usage with pagination handling.
- **Error Resilient**: Continues processing even if individual repos or queries fail.

## 📋 Report Contents

Each daily issue includes:
- Executive summary with counts per alert type
- Per-repository breakdown
- Actionable links to each alert in GitHub UI
- Latest contributor info to identify who might have introduced issues recently

If no open alerts are found: A celebratory message encouraging continued good security hygiene!

## 📐 Architecture & Design

See [docs/DESIGN.md](docs/DESIGN.md) for the full technical design, Mermaid workflow diagram, API strategy, and future enhancements.

## 🛠️ Setup Guide

### 1. Create a Personal Access Token (PAT)

You **must** create a PAT because the default `GITHUB_TOKEN` in workflows does not have sufficient permissions to read security alerts from other repositories.

**Recommended: Fine-grained Personal Access Token**
- Go to [GitHub Settings > Developer settings > Personal access tokens > Fine-grained tokens](https://github.com/settings/tokens?type=beta)
- Click "Generate new token"
- **Resource owner**: Your account (r0yce)
- **Repository access**: All repositories (or select specific ones)
- **Permissions**:
  - **Read** access to:
    - Contents
    - Metadata
    - Security events (critical for alerts)
  - **Read and Write** to Issues (for creating reports in this repo)
- Generate and copy the token immediately (it won't be shown again)

**Alternative: Classic PAT**
- Scopes: `repo` (full) + `security_events` (read)

**Security Note**: This token has significant access. Treat it like a password. Rotate periodically.

### 2. Add PAT as Repository Secret

1. In this repository, go to **Settings > Secrets and variables > Actions**
2. Click "New repository secret"
3. Name: `SECURITY_REPORT_PAT`
4. Paste the PAT value
5. Save

### 3. Verify Workflow

The workflow file is already committed at `.github/workflows/daily-security-report.yml`

- It is scheduled to run daily at **10:00 UTC** (2:00 AM CDT for Austin, TX)
- You can manually trigger it anytime from the **Actions** tab > Select workflow > "Run workflow"

### 4. (Optional) Customize

Edit the workflow file to:
- Change the cron schedule (e.g., `'0 6 * * *'` for 6 AM UTC)
- Modify labels
- Enhance the report format or add notifications (Slack, email via other actions)

## 🔄 How the Workflow Works

1. **Authentication**: Uses your `SECURITY_REPORT_PAT` secret for broad read access.
2. **Repository Discovery**: Queries all repositories you own, collaborate on, or are a member of via GraphQL `viewer.repositories`.
3. **Alert Fetching** (per repository):
   - GraphQL: `vulnerabilityAlerts` (Dependabot) and `codeScanningAlerts`
   - REST: `secretScanning.listAlertsForRepo` + locations for paths
4. **Contributor Lookup**: For repos with alerts, fetches the most recent commit author via GraphQL.
5. **Report Generation**: Builds a detailed Markdown report.
6. **Issue Creation**: Opens a new issue with labels `security`, `daily-report`, `alerts`.

## 📊 Example Report Structure

```
# Daily Security Alerts Report - 2026-05-14

**Generated:** 2026-05-14T14:00:00Z  
**Total Open Alerts:** 12  
**Repositories with Alerts:** 3/47 scanned

## Summary by Type
- 🔐 Secret Scanning: 5
- 🛡️ Code Scanning: 4
- 🐛 Dependabot: 3

## Repository: r0yce/my-app

**Latest Contributor:** Jane Doe <jane@example.com> (@janedoe) - 2026-05-13

### 🔐 Secret Scanning Alerts
- **Type:** GitHub Personal Access Token  
  **Path:** `config/secrets.env` (commit: a1b2c3d)  
  **Created:** 2026-05-10  
  **Link:** [View Alert](https://github.com/r0yce/my-app/security/secret-scanning/42)
  > Note: Actual secret values are redacted by GitHub's API for security reasons.

### 🛡️ Code Scanning Alerts
- **Rule:** SQL Injection  
  **Severity:** high  
  **Path:** `src/api.js:45`  
  **Created:** 2026-05-12  
  **Link:** [View in Code Scanning](https://github.com/r0yce/my-app/security/code-scanning/7)

### 🐛 Dependabot Alerts
- **Summary:** Prototype Pollution in lodash  
  **Severity:** HIGH  
  **Path:** `package.json`  
  **Link:** [View Advisory](https://github.com/advisories/...)

---

*Report generated by automated workflow. Review and triage promptly.*
```

## ⚠️ Important Notes & Limitations

- **Secret Values**: GitHub intentionally does not return the full secret string in API responses. The report shows type, location (path), and links to the UI where you can view more (after authentication).
- **Performance**: For users with 100+ repos or many alerts, the workflow may take several minutes. It is designed to be efficient.
- **Permissions**: Ensure the PAT has access to all relevant repositories. Private repos, org repos, and security features must be enabled.
- **Rate Limits**: GraphQL (5,000 points/hr) and REST are respected; pagination and error handling included.
- **No Write Access to Other Repos**: The workflow only creates issues in *this* repository.

## 🆘 Troubleshooting

**No alerts or repos appearing?**
- Verify `SECURITY_REPORT_PAT` is set correctly and has the right scopes.
- Check Actions logs for GraphQL/REST errors (e.g., "Resource not accessible by integration").
- Confirm security features (Code scanning, Secret scanning, Dependabot) are enabled on your repos.

**Workflow failing?**
- Check the Actions run logs.
- Ensure the repository has Actions enabled.

**Want more?**
- Add a step to post to Slack/Discord using `slackapi/slack-github-action`.
- Filter only high-severity alerts.
- Archive old reports automatically.

## 📝 License

This project is provided as-is for personal/organizational use. Feel free to adapt the workflow for your needs.

---

*Created with ❤️ by Grok for Royce Miller (@r0yce on GitHub)*
