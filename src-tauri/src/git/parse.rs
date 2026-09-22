//! Porcelain v1 parsing matching `@shared/workspace/git-status`.

#[derive(Debug, Clone)]
pub struct PorcelainEntry {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
}

pub fn parse_porcelain_v1(output: &str) -> Vec<PorcelainEntry> {
    let records: Vec<&str> = output.split('\0').collect();
    let mut entries = Vec::new();
    let mut i = 0;
    while i < records.len() {
        let record = records[i];
        i += 1;
        if record.len() < 4 || record.as_bytes().get(2) != Some(&b' ') {
            continue;
        }
        let index_status = record[..1].to_string();
        let worktree_status = record[1..2].to_string();
        let mut entry = PorcelainEntry {
            path: record[3..].to_string(),
            original_path: None,
            index_status: index_status.clone(),
            worktree_status: worktree_status.clone(),
        };
        if uses_rename(&index_status, &worktree_status) && i < records.len() {
            entry.original_path = Some(records[i].to_string());
            i += 1;
        }
        entries.push(entry);
    }
    entries
}

fn uses_rename(index: &str, worktree: &str) -> bool {
    matches!(index, "R" | "C") || matches!(worktree, "R" | "C")
}

pub fn classify(entry: &PorcelainEntry) -> (&'static str, &'static str) {
    let pair = format!("{}{}", entry.index_status, entry.worktree_status);
    if pair == "??" {
        return ("untracked", "U");
    }
    const CONFLICTS: &[&str] = &["DD", "AU", "UD", "UA", "DU", "AA", "UU"];
    if CONFLICTS.contains(&pair.as_str()) || pair.contains('U') {
        return ("conflict", "C");
    }
    if pair.contains('D') {
        return ("deleted", "D");
    }
    if pair.contains('R') || pair.contains('C') {
        return ("renamed", "R");
    }
    if pair.contains('A') {
        return ("added", "A");
    }
    ("modified", "M")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modified_and_untracked() {
        let output = " M src/app.ts\0?? new.rs\0";
        let entries = parse_porcelain_v1(output);
        assert_eq!(entries.len(), 2);
        assert_eq!(classify(&entries[0]), ("modified", "M"));
        assert_eq!(classify(&entries[1]), ("untracked", "U"));
    }
}
