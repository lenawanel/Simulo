// Like build.js, since this isn't supposed to be in `dist`, it's not a TypeScript file to build and is just a plain JS file. It works cross-platform.

// deploy.js emulates the server's routes in a static way, so that the client can be served from GitHub Pages.
// This leads to a lot of duplicate assets and code, and it'll always be better to run the provided server instead, but this is a good alternative for when static hosting is the only option.

import fs from 'fs';
import * as url from "url";
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
import path from 'path';

import ghpages from 'gh-pages';

import chalk from 'chalk';

// import child_process
import { exec } from 'child_process';

const packageJson = JSON.parse(fs.readFileSync(__dirname + '/package.json', 'utf8'));

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

var buildInfo = chalk.bold('Deploying ' + capitalizeFirstLetter(packageJson.name) + ' v' + packageJson.version + '...\n');
console.log(buildInfo);

var steps = [
    async (stepInfo) => {
        console.log(stepInfo, 'Checking for build...');
        if (!fs.existsSync(path.join(__dirname, 'dist'))) {
            console.log(chalk.redBright('No build found! Please run `npm run build` first.'));
            process.exit(1);
        }
    },
    // add an empty .nojekyll file to dist so that node_modules is served properly
    async (stepInfo) => {
        console.log(stepInfo, 'Adding .nojekyll file...');
        fs.writeFileSync(path.join(__dirname, 'dist', '.nojekyll'), 'Please don\'t jekyll me.');
    },
    // copy dist/node_modules to dist/client
    async (stepInfo) => {
        console.log(stepInfo, 'Copying node_modules to client/node_modules...');
        copyFolderRecursiveSync(path.join(__dirname, 'dist', 'node_modules'), path.join(__dirname, 'dist', 'client', 'node_modules'));
    },
    // copy dist/shared to dist/client/shared
    async (stepInfo) => {
        console.log(stepInfo, 'Copying shared to client/shared...');
        copyFolderRecursiveSync(path.join(__dirname, 'dist', 'shared'), path.join(__dirname, 'dist', 'client', 'shared'));
    },
    // copy dist/media to dist/client/media
    async (stepInfo) => {
        console.log(stepInfo, 'Copying media to client/media...');
        copyFolderRecursiveSync(path.join(__dirname, 'dist', 'media'), path.join(__dirname, 'dist', 'client', 'media'));
    },
    // copy dist/version.json to dist/client/version (no extension)
    async (stepInfo) => {
        console.log(stepInfo, 'Copying version.json to client/version...');
        fs.copyFileSync(path.join(__dirname, 'dist', 'version.json'), path.join(__dirname, 'dist', 'client', 'version'));
    },
    // copy node_modules/@mdi/svg/svg to dist/client/icons
    async (stepInfo) => {
        console.log(stepInfo, 'Copying icons...');
        var nmIcons = path.join(__dirname, 'dist', 'node_modules', '@mdi', 'svg', 'svg');
        var clientIcons = path.join(__dirname, 'dist', 'client', 'icons');
        // first, lets scan clientIcons and delete everything from there in nmIcons
        var files = fs.readdirSync(clientIcons);
        files.forEach(function (file) {
            // there arent dirs, we can just unlink
            if (fs.existsSync(path.join(nmIcons, file))) {
                fs.unlinkSync(path.join(nmIcons, file));
            }
        });
        copyFolderRecursiveSync(nmIcons, clientIcons);
    },
    // copy website to dist/
    async (stepInfo) => {
        console.log(stepInfo, 'Copying website...');
        copyFolderRecursiveSync(path.join(__dirname, 'website'), path.join(__dirname, 'dist'));
    },
    // copy client/assets to dist/assets so website can use it
    async (stepInfo) => {
        console.log(stepInfo, 'Copying assets...');
        copyFolderRecursiveSync(path.join(__dirname, 'dist', 'client', 'assets'), path.join(__dirname, 'dist', 'assets'));
    },
    // deploy to gh-pages
    async (stepInfo) => {
        console.log(stepInfo, 'Deploying to GitHub Pages...');
        await new Promise((resolve, reject) => {
            ghpages.publish(path.join(__dirname, 'dist'), {
                branch: 'gh-pages',
                dotfiles: true,
            }, function (err) {
                if (err) {
                    console.log(chalk.redBright('Error deploying to GitHub Pages: ' + err));
                    reject(err);
                    process.exit(1);
                }
                else {
                    resolve();
                }
            });
        });
    }
];

function copyFolderRecursiveSync(source, target) {
    var files = [];
    // check if folder needs to be created or integrated
    var targetFolder = target;
    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder);
    }
    // copy
    if (fs.lstatSync(source).isDirectory()) {
        files = fs.readdirSync(source);
        files.forEach(function (file) {
            var curSource = path.join(source, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                copyFolderRecursiveSync(curSource, path.join(targetFolder, path.basename(curSource)));
            }
            else {
                fs.copyFileSync(curSource, path.join(targetFolder, path.basename(curSource)));
            }
        });
    }
}

// run steps
for (var i = 0; i < steps.length; i++) {
    await steps[i]((i + 1) + '/' + steps.length);
}


console.log(chalk.greenBright.bold('\nDeployed successfully!') + '\nNote: While changes have been sent to GitHub, it takes up to 10 minutes for them to be visible.');