const fs = require("fs");
const { execSync } = require("child_process");
try {
  const files = execSync("find ~/.gradle/caches -name \"values.xml\" -type f 2>/dev/null").toString().trim().split("\n");
  files.forEach(file => {
    if (file && fs.existsSync(file)) {
      let content = fs.readFileSync(file, "utf8");
      if (content.includes("dualscreen_placeholder")) {
        try { fs.chmodSync(file, "644"); } catch(e) {}
        content = content.replace(/dualscreen_placeholder/g, "compat_placeholder");
        fs.writeFileSync(file, content, "utf8");
        try { fs.chmodSync(file, "444"); } catch(e) {}
        console.log("Neutralized in:", file);
      }
    }
  });
} catch(e) {}
