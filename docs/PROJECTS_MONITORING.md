# Projects Monitoring

Use `/mithril-os/config/projects-monitor.json` to define projects shown in Ops Console > Projects.

Example:

```json
{
  "projects": [
    { "name": "Mithril-OS", "path": "/mithril-os", "owner": "OddEye" },
    { "name": "Project A", "path": "/path/to/project-a", "owner": "koda" },
    { "name": "Project B", "path": "/path/to/project-b", "owner": "koda" },
    { "name": "Project C", "path": "/path/to/project-c", "owner": "koda" }
  ]
}
```

The Projects page shows branch status, clean/dirty state, and recent commits for each configured repo.
