const fs = require("fs");

exports.default = async function (context) {
    let env = context.electronPlatformName

    let unpack_dir = ''
    if (env === 'win32') {
        unpack_dir = 'win-unpacked'
    } else if (env === 'linux') {
        unpack_dir = 'linux-unpacked'
    } else if (env === 'darwin') {
        unpack_dir = 'mac'
    }

    if (unpack_dir) {
        console.log("\n- [Damecon] Copy extensions to unpacked build...\n");

        const extensions = ['uBlock', 'stylus', 'Violentmonkey'];
        const basePath = '../../extensions/';

        extensions.forEach(extension => {
            const sourcePath = `${basePath}${extension}`;
            const destPath = env === 'darwin' 
                ? `./build/${unpack_dir}/Damecon.app/Contents/extensions/${extension}`
                : `./build/${unpack_dir}/extensions/${extension}`;

            if (fs.existsSync(sourcePath)) {
                fs.mkdirSync(destPath, { recursive: true });
                fs.cpSync(sourcePath, destPath, { recursive: true });
            } else {
                console.error(`Extension directory not found: ${sourcePath}`);
            }
        });
    }
}
