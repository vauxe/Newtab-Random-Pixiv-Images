English/[中文](./readme_cn.md)

# Newtab Random Pixiv Images

Randomly picks one image from Pixiv search results to replace your new tab background. By default search uses popular tags like "10000users入り". In the bottom right corner, you can refresh, open the tag manager, open the artwork page, and exclude tags. You may need to login Pixiv first to make search functionality work.

## Install
### chrome/edge:
1. Clone or download this project to local.
2. Open chrome and goto "chrome://extensions/" page.
3. Toggle topright "Developer mode" button to enable chrome developer mode.
4. Click "Load unpacked" button, then in the open window select the "src" directory from downloaded project.
5. Open newtab and enjoy a randomly picked pixiv illustration!

### firefox:
1. Clone or download this project to local.
2. Open firefox and goto "about:debugging" page.
3. Select "This Firefox" tab on the left side.
4. Click "Load Temporary Add-on..." button, then in the open window goto the "src_firefox" directory, select "manifest.json" file.
5. Open newtab and enjoy a randomly picked pixiv illustration!

## Features

- 🎨 **Random wallpaper** — New tab shows a random Pixiv illustration.
- 🔄 **One-click refresh** — Refresh button loads the next image.
- 🔎 **Open artwork page** — The eye icon opens the current artwork page.
- 🏷️ **Tag manager** — Visual AND/OR/NOT builder with presets.
- 🚫 **Global blocklist** — Exclude tags globally (applies to all presets).
- 📦 **Import/Export** — Backup or share tag presets as JSON.
- 🌐 **Multi-language UI** — English / Chinese / Japanese.

## Pixiv Search Boolean Logic

Pixiv search supports a rich set of boolean operators for tag filtering:

### Basic Operators

| Operator | Syntax        | Example                | Description          |
| -------- | ------------- | ---------------------- | -------------------- |
| **AND**  | `A B` (space) | `初音ミク VOCALOID`    | Both tags must match |
| **OR**   | `A OR B`      | `初音ミク OR 鏡音リン` | Either tag matches   |
| **NOT**  | `-A`          | `-R-18 -漫画`          | Exclude tags         |

### Grouping with Parentheses

| Pattern                | Syntax                | Example                                                              |
| ---------------------- | --------------------- | -------------------------------------------------------------------- |
| **OR Group**           | `(A OR B)`            | `(10000users入り OR 30000users入り)`                                 |
| **AND + OR Groups**    | `A (B OR C)`          | `風景 (夕焼け OR 朝焼け)`                                            |
| **Multiple OR Groups** | `A (B OR C) (D OR E)` | `VOCALOID (初音ミク OR 鏡音リン) (10000users入り OR 30000users入り)` |

### Advanced Patterns

| Pattern                      | Syntax                    | Example                                                 |
| ---------------------------- | ------------------------- | ------------------------------------------------------- |
| **Nested Parentheses**       | `((A OR B) OR (C D))`     | `((初音ミク OR 鏡音リン) OR (VOCALOID 女の子))`         |
| **OR Connecting AND Groups** | `(A B) OR (C D)`          | `(初音ミク 10000users入り) OR (鏡音リン 5000users入り)` |
| **Explicit AND in Nesting**  | `((A OR B) AND (C OR D))` | `((水彩 OR 油絵) AND (風景 OR 自然))`                   |

### Complex Example

```
VOCALOID (初音ミク OR 鏡音リン) (10000users入り OR 30000users入り) -R-18 -漫画
```

This query means: **VOCALOID** AND (**初音ミク** OR **鏡音リン**) AND (**10000users入り** OR **30000users入り**), excluding **R-18** and **漫画**.

## License

This extension is distributed under MIT license.
