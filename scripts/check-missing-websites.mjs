import { readFileSync } from "fs";
import { readdirSync, statSync } from "fs";
import { join } from "path";

const metadataDir = "report_pipeline/election-metadata";

function findJsonFiles(dir, basePath = "") {
  const files = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = basePath ? `${basePath}/${entry}` : entry;

    if (statSync(fullPath).isDirectory()) {
      files.push(...findJsonFiles(fullPath, relativePath));
    } else if (entry.endsWith(".json")) {
      files.push({ path: fullPath, relativePath });
    }
  }

  return files;
}

function hasWebsite(election) {
  const website = election.website;
  return website !== null && website !== undefined && website !== "";
}

const jsonFiles = findJsonFiles(metadataDir);
const electionsWithoutWebsites = [];

for (const { path, relativePath } of jsonFiles) {
  try {
    const content = readFileSync(path, "utf-8");
    const metadata = JSON.parse(content);

    if (metadata.elections) {
      for (const [electionKey, election] of Object.entries(
        metadata.elections,
      )) {
        if (!hasWebsite(election)) {
          electionsWithoutWebsites.push({
            jurisdiction: metadata.name,
            jurisdictionPath: metadata.path,
            electionKey,
            electionName: election.name,
            date: election.date,
            metadataFile: relativePath,
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error reading ${relativePath}:`, error.message);
  }
}

console.log("Elections Without Websites Report");
console.log("=================================\n");

if (electionsWithoutWebsites.length === 0) {
  console.log("All elections have websites!");
} else {
  console.log(
    `Found ${electionsWithoutWebsites.length} election(s) without websites:\n`,
  );

  for (const election of electionsWithoutWebsites) {
    console.log(
      `Jurisdiction: ${election.jurisdiction} (${election.jurisdictionPath})`,
    );
    console.log(`Election: ${election.electionName}`);
    console.log(`Date: ${election.date}`);
    console.log(`Key: ${election.electionKey}`);
    console.log(`Metadata File: ${election.metadataFile}`);
    console.log("");
  }

  console.log("\nSummary by Jurisdiction:");
  const byJurisdiction = {};
  for (const election of electionsWithoutWebsites) {
    if (!byJurisdiction[election.jurisdictionPath]) {
      byJurisdiction[election.jurisdictionPath] = [];
    }
    byJurisdiction[election.jurisdictionPath].push(election);
  }

  for (const [jurisdictionPath, elections] of Object.entries(byJurisdiction)) {
    console.log(`  ${jurisdictionPath}: ${elections.length} election(s)`);
  }
}
