#!/bin/bash
set -e

# Audit script to check compression/extraction consistency
# Compares raw-data directories with archives to find missing or inconsistent entries

cd "$(dirname "$0")"

SOURCE_DIR="raw-data"
ARCHIVE_DIR="archives"

echo "=== Archive Audit ==="
echo "Checking consistency between $SOURCE_DIR/ and $ARCHIVE_DIR/"
echo ""

MISSING_COUNT=0
FOUND_COUNT=0
ORPHAN_COUNT=0

# Function to check if archive exists for a directory
check_archive() {
    local dir_path="$1"
    local relative_path="${dir_path#$SOURCE_DIR/}"
    local parent_dir=$(dirname "$relative_path")
    local dir_name=$(basename "$relative_path")
    local archive_path="$ARCHIVE_DIR/$parent_dir/$dir_name.tar.xz"
    
    if [ -f "$archive_path" ]; then
        echo "  ✓ $relative_path"
        FOUND_COUNT=$((FOUND_COUNT + 1))
        return 0
    else
        echo "  ✗ MISSING: $relative_path"
        echo "    Expected: $archive_path"
        MISSING_COUNT=$((MISSING_COUNT + 1))
        return 1
    fi
}

echo "=== Checking Alameda (3-level deep) ==="
while IFS= read -r dir; do
    check_archive "$dir"
done < <(find "$SOURCE_DIR/us/ca/alameda" -mindepth 3 -maxdepth 3 -type d 2>/dev/null | sort)
echo ""

echo "=== Checking San Francisco (2-level deep) ==="
while IFS= read -r dir; do
    check_archive "$dir"
done < <(find "$SOURCE_DIR/us/ca/sfo" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)
echo ""

echo "=== Checking Maine (2-level deep) ==="
while IFS= read -r dir; do
    check_archive "$dir"
done < <(find "$SOURCE_DIR/us/me" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)
echo ""

echo "=== Checking NYC (2-level deep) ==="
while IFS= read -r dir; do
    check_archive "$dir"
done < <(find "$SOURCE_DIR/us/ny/nyc" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)
echo ""

echo "=== Checking Ontario (2-level deep) ==="
while IFS= read -r dir; do
    check_archive "$dir"
done < <(find "$SOURCE_DIR/ca/on/yxu" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)
echo ""

echo "=== Checking smaller jurisdictions ==="
for dir in us/ak/2022/08 us/nm/saf/2018/03 us/vt/btv/2009/03 us/wy-dem/2020/04; do
    if [ -d "$SOURCE_DIR/$dir" ]; then
        check_archive "$SOURCE_DIR/$dir"
    fi
done
echo ""

echo "=== Checking for orphaned archives (archives without raw-data) ==="
while IFS= read -r archive; do
    relative_path="${archive#$ARCHIVE_DIR/}"
    archive_name="${relative_path%.tar.xz}"
    expected_dir="$SOURCE_DIR/$archive_name"
    
    if [ ! -d "$expected_dir" ]; then
        echo "  ⚠ ORPHAN: $archive_name (no matching directory in raw-data)"
        ORPHAN_COUNT=$((ORPHAN_COUNT + 1))
    fi
done < <(find "$ARCHIVE_DIR" -name "*.tar.xz" -type f | sort)
echo ""

echo "=== Summary ==="
echo "Found archives: $FOUND_COUNT"
echo "Missing archives: $MISSING_COUNT"
echo "Orphaned archives: $ORPHAN_COUNT"
echo ""

if [ $MISSING_COUNT -gt 0 ]; then
    echo "⚠️  WARNING: Some directories in raw-data/ are missing archives!"
    echo "   Run ./compress-to-archives.sh to create missing archives"
    echo ""
fi

if [ $ORPHAN_COUNT -gt 0 ]; then
    echo "⚠️  WARNING: Some archives don't have matching directories in raw-data/"
    echo "   These may be old archives that should be cleaned up"
    echo ""
fi

if [ $MISSING_COUNT -eq 0 ] && [ $ORPHAN_COUNT -eq 0 ]; then
    echo "✅ All checks passed! Archives are consistent with raw-data/"
fi

# Check if we can regenerate all reports
echo ""
echo "=== Report Regeneration Check ==="
REPORT_COUNT=$(find reports -name "report.json" -type f 2>/dev/null | wc -l | tr -d ' ')
echo "Found $REPORT_COUNT reports"
echo ""
echo "To verify all reports can be regenerated:"
echo "  1. rm -rf raw-data/*"
echo "  2. ./extract-from-archives.sh"
echo "  3. ./report.sh"
echo "  4. Compare generated reports with existing ones"
