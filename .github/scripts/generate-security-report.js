const { context, core } = require('@actions/github');

/**
 * Full Daily Security Alerts Report Generator
 * - GraphQL first (repos, Dependabot, Code Scanning, contributors)
 * - REST only for Secret Scanning (best path + location support)
 */
async function generateReport(github) {
  const today = new Date().toISOString().split('T')[0];
  const reportTitle = `Daily Security Alerts Report - ${today}`;

  console.log('🚀 Starting FULL daily security report for', today);

  // 1. Fetch all repositories (GraphQL with pagination)
  let allRepos = [];
  let hasNextPage = true;
  let afterCursor = null;

  const repoQuery = `
    query($after: String) {
      viewer {
        repositories(
          first: 100,
          after: $after,
          affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          nodes {
            name
            owner { login }
            url
            defaultBranchRef { name }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  while (hasNextPage) {
    try {
      const result = await github.graphql(repoQuery, { after: afterCursor });
      const page = result.viewer.repositories;
      allRepos = allRepos.concat(page.nodes);
      hasNextPage = page.pageInfo.hasNextPage;
      afterCursor = page.pageInfo.endCursor;
      console.log(`   Fetched ${page.nodes.length} repos (total: ${allRepos.length})`);
    } catch (err) {
      console.error('   ❌ Repo fetch error:', err.message);
      hasNextPage = false;
    }
  }

  console.log(`📦 Total repos discovered: ${allRepos.length}`);

  // 2. Collect alerts + contributor info per repo
  const findings = [];
  let totalVuln = 0, totalCode = 0, totalSecret = 0;

  for (const repo of allRepos) {
    const owner = repo.owner.login;
    const repoName = repo.name;
    const fullName = `${owner}/${repoName}`;
    console.log(`\n🔍 Processing ${fullName}...`);

    let repoFindings = [];
    let hasAlerts = false;

    // --- Dependabot Vulnerabilities (GraphQL) ---
    try {
      const q = `query($o: String!, $r: String!) {
        repository(owner: $o, name: $r) {
          vulnerabilityAlerts(first: 100, states: [OPEN]) {
            nodes {
              createdAt
              securityAdvisory { summary severity permalink }
              vulnerableManifestPath
              vulnerableRequirements
            }
          }
        }
      }`;
      const res = await github.graphql(q, { o: owner, r: repoName });
      const alerts = res.repository?.vulnerabilityAlerts?.nodes || [];
      for (const a of alerts) {
        repoFindings.push({
          type: 'Dependabot',
          emoji: '🐛',
          title: a.securityAdvisory?.summary || 'Vulnerability',
          severity: a.securityAdvisory?.severity || 'UNKNOWN',
          path: a.vulnerableManifestPath || 'N/A',
          created: a.createdAt,
          link: a.securityAdvisory?.permalink || `https://github.com/${fullName}/security/dependabot`,
          extra: a.vulnerableRequirements || ''
        });
        totalVuln++;
        hasAlerts = true;
      }
      if (alerts.length) console.log(`   🐛 ${alerts.length} Dependabot alerts`);
    } catch (e) { console.error(`   Dependabot error: ${e.message}`); }

    // --- Code Scanning (GraphQL) ---
    try {
      const q = `query($o: String!, $r: String!) {
        repository(owner: $o, name: $r) {
          codeScanningAlerts(first: 100, states: [OPEN]) {
            nodes {
              createdAt
              rule { name severity securitySeverityLevel description }
              mostRecentInstance { location { path startLine } }
            }
          }
        }
      }`;
      const res = await github.graphql(q, { o: owner, r: repoName });
      const alerts = res.repository?.codeScanningAlerts?.nodes || [];
      for (const a of alerts) {
        const loc = a.mostRecentInstance?.location;
        const path = loc ? `${loc.path || 'file'}:${loc.startLine || ''}` : 'N/A';
        repoFindings.push({
          type: 'Code Scanning',
          emoji: '🛡️',
          title: a.rule?.name || 'Code finding',
          severity: a.rule?.securitySeverityLevel || a.rule?.severity || 'medium',
          path,
          created: a.createdAt,
          link: `https://github.com/${fullName}/security/code-scanning`,
          extra: a.rule?.description || ''
        });
        totalCode++;
        hasAlerts = true;
      }
      if (alerts.length) console.log(`   🛡️ ${alerts.length} Code Scanning alerts`);
    } catch (e) { console.error(`   Code scanning error: ${e.message}`); }

    // --- Secret Scanning (REST + locations for exact path) ---
    try {
      const list = await github.rest.secretScanning.listAlertsForRepo({
        owner, repo: repoName, state: 'open', per_page: 100
      });
      const alerts = list.data || [];
      for (const a of alerts) {
        let path = 'See GitHub UI for full location';
        try {
          const locs = await github.rest.secretScanning.listLocationsForAlert({
            owner, repo: repoName, alert_number: a.number
          });
          if (locs.data?.[0]?.details?.path) path = locs.data[0].details.path;
        } catch (_) {}
        const snippet = a.secret ? a.secret.slice(0, 20) + '…' : 'REDACTED (GitHub does not expose full value)';
        repoFindings.push({
          type: 'Secret Scanning',
          emoji: '🔐',
          title: a.secret_type_display_name || a.secret_type || 'Secret detected',
          severity: 'high',
          path,
          created: a.created_at,
          link: a.html_url || `https://github.com/${fullName}/security/secret-scanning/${a.number}`,
          extra: `Type: ${a.secret_type || 'unknown'} | ${snippet}`
        });
        totalSecret++;
        hasAlerts = true;
      }
      if (alerts.length) console.log(`   🔐 ${alerts.length} Secret Scanning alerts`);
    } catch (e) {
      if (!e.message.toLowerCase().includes('not enabled')) {
        console.error(`   Secret scanning error: ${e.message}`);
      }
    }

    // --- Latest Contributor (GraphQL) ---
    let contributor = 'No recent commits or no alerts in this repo';
    if (hasAlerts && repo.defaultBranchRef) {
      try {
        const q = `query($o: String!, $r: String!) {
          repository(owner: $o, name: $r) {
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 1) {
                    nodes {
                      author { name email user { login } }
                      committedDate
                    }
                  }
                }
              }
            }
          }
        }`;
        const res = await github.graphql(q, { o: owner, r: repoName });
        const hist = res.repository?.defaultBranchRef?.target?.history?.nodes?.[0];
        if (hist?.author) {
          const au = hist.author;
          const name = au.name || 'Unknown';
          const email = au.email || 'hidden';
          const login = au.user?.login ? `@${au.user.login}` : '';
          const date = hist.committedDate ? new Date(hist.committedDate).toISOString().split('T')[0] : '';
          contributor = `${name} <${email}> ${login} (last commit ${date})`;
        }
      } catch (e) {
        console.error(`   Contributor error: ${e.message}`);
      }
    }

    if (repoFindings.length > 0) {
      findings.push({ repo: fullName, url: repo.url, contributor, alerts: repoFindings });
    }
  }

  const grandTotal = totalVuln + totalCode + totalSecret;
  console.log(`\n✅ Done. Total alerts found: ${grandTotal}`);

  // 3. Build beautiful Markdown report
  let body = `# ${reportTitle}\n\n`;
  body += `**Generated:** ${new Date().toISOString()}\n**Repos scanned:** ${allRepos.length}\n**Total open alerts:** ${grandTotal}\n\n`;

  if (grandTotal === 0) {
    body += `## 🎉 No Open Security Alerts Today!\n\nExcellent work — all repositories are clean. This check runs daily.\n`;
  } else {
    body += `## 📊 Summary\n- 🐛 Dependabot: ${totalVuln}\n- 🛡️ Code Scanning: ${totalCode}\n- 🔐 Secret Scanning: ${totalSecret}\n\n---\n\n`;

    for (const f of findings) {
      body += `## 📦 [${f.repo}](${f.url})\n**Latest Contributor:** ${f.contributor}\n\n`;

      const byType = {
        Dependabot: f.alerts.filter(a => a.type === 'Dependabot'),
        'Code Scanning': f.alerts.filter(a => a.type === 'Code Scanning'),
        'Secret Scanning': f.alerts.filter(a => a.type === 'Secret Scanning')
      };

      for (const [type, list] of Object.entries(byType)) {
        if (list.length === 0) continue;
        const emoji = type === 'Dependabot' ? '🐛' : type === 'Code Scanning' ? '🛡️' : '🔐';
        body += `### ${emoji} ${type} (${list.length})\n\n`;
        for (const a of list) {
          body += `- **${a.title}**\n`;
          body += `  **Path:** \`${a.path}\`  |  **Severity:** ${a.severity}\n`;
          body += `  **Created:** ${a.created ? new Date(a.created).toISOString().split('T')[0] : 'N/A'}\n`;
          if (a.extra) body += `  **Details:** ${a.extra}\n`;
          body += `  **🔗 [View on GitHub](${a.link})**\n\n`;
        }
      }
      body += `---\n\n`;
    }
    body += `> **Action required:** Review and remediate alerts promptly.\n`;
  }

  body += `\n---\n*Automated report • github-security-alert-reporter (GraphQL preferred) • ${today}*\n`;

  // 4. Create the issue
  try {
    const issue = await github.rest.issues.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: reportTitle,
      body,
      labels: ['security', 'daily-report', 'alerts']
    });
    console.log(`✅ Created Issue #${issue.data.number}: ${reportTitle}`);
    return issue.data;
  } catch (err) {
    console.error('❌ Failed to create issue:', err.message);
    core.setFailed(`Issue creation failed: ${err.message}`);
    throw err;
  }
}

module.exports = { generateReport };
