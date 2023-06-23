import SimuloTheme from '../../../shared/src/SimuloTheme.js';
import Box2DFactory from '../../../node_modules/box2d-wasm/dist/es/entry.js';
import SimuloClient from '../../../shared/src/SimuloClient.js';
import SimuloServerController from '../../../shared/src/SimuloServerController.js';
import themesJSON from "../../../shared/themes.js";
import SimuloViewer from '../SimuloViewer/index.js';
import themes from '../../../shared/themes.js';
import { hsvToRgb } from '../../../shared/src/utils.js';

function queryParent(element: HTMLElement, className: string): HTMLElement | null {
    var parent: HTMLElement = element.parentNode as HTMLElement;
    while (parent) {
        if (parent.classList.contains(className)) {
            return parent;
        }
        parent = parent.parentNode as HTMLElement;
    }
    return null;
}

import { SimuloPolygon, SimuloCircle, SimuloEdge, SimuloShape, SimuloRectangle } from '../../../shared/src/SimuloShape.js';
import SimuloCreatingObject, { SimuloCreatingPolygon } from '../../../shared/src/SimuloCreatingObject.js';

const personPoints = [{
    x: 0,
    y: 0.256
}, {
    x: 0.2848,
    y: 0.1996
}, {
    x: 0.476,
    y: 0.0688
}, {
    x: 0.6016,
    y: -0.10800000000000001
}, {
    x: 0.668,
    y: -0.31160000000000004
}, {
    x: 0.6712,
    y: -1.3088
}, {
    x: 0.6572,
    y: -1.3876
}, {
    x: 0.5804,
    y: -1.4388
}, {
    x: -0.5664,
    y: -1.4356
}, {
    x: -0.6328,
    y: -1.404
}, {
    x: -0.6616,
    y: -1.34
}, {
    x: -0.668,
    y: -0.31160000000000004
}, {
    x: -0.5988000000000001,
    y: -0.122
}, {
    x: -0.49240000000000006,
    y: 0.0504
}, {
    x: -0.26,
    y: 0.2068
}, {
    x: -0.1312,
    y: 0.2456
}];

enum ToastType {
    SUCCESS,
    ERROR,
    INFO,
    WARNING
}

interface SimuloSavedObject {
    name: string;
    shapes: SimuloShape[];
}
/** `SimuloClientController` manages connecting to the server, `SimuloViewer` and the UI. */
class SimuloClientController {
    client: SimuloClient;
    timeScale: number | null = null;
    paused: boolean | null = null;
    serverController: SimuloServerController;
    theme: SimuloTheme;
    themes: { [key: string]: SimuloTheme } = {};
    maxZoom = 5;
    minZoom = 0.1;
    scrollSensitivity = 0.0005;
    spawningSavedObject: string | null = null;
    savedObjects: {
        [key: string]: SimuloSavedObject;
    } = {
            "person": {
                name: "Person",
                shapes: [
                    {
                        type: "polygon",
                        x: 0, // this is relative to the mouse position
                        y: 0,
                        angle: Math.PI,
                        color: "#00000000",
                        borderWidth: null,
                        borderScaleWithZoom: false,
                        image: "assets/textures/body.png",
                        id: -1,
                        points: personPoints,
                        vertices: personPoints
                    } as SimuloPolygon,
                    {
                        type: "circle",
                        x: 0,
                        y: -0.752,
                        radius: 0.684,
                        color: "#99e077",
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false,
                        circleCake: false,
                        id: -1,
                        angle: Math.PI
                    } as SimuloCircle,
                ]
            }
        };

    player = {
        x: 0,
        y: 0,
        name: 'Anonymous',
        down: false,
        zoom: 1,
    };

    viewer: SimuloViewer;

    // TODO: Make these created by this script (loaded from an HTML file) so each ClientController can define its own UI
    timeScaleSlider = document.getElementById('time-scale-slider') as HTMLInputElement;
    timeScaleInput = document.getElementById('time-scale-input') as HTMLInputElement;
    pauseButton = document.getElementById('pause-button') as HTMLElement;

    /** Entities to render. This is updated every time a world_update from the server is received.
     * 
     * It only includes properties that are needed for rendering, things like mass and velocity must be obtained from the server. */
    private entities: SimuloShape[] = [];
    private creatingObjects: {
        [key: string]: SimuloCreatingObject;
    } = {};
    private selectedObjects: {
        [key: string]: string[];
    } = {};
    private creatingSprings: {
        [key: string]: {
            start: [x: number, y: number];
            image: string | null;
            end: [x: number, y: number];
            width: number;
        };
    } = {};
    private players: { [key: string]: { x: number, y: number } } = {};
    private springs: {
        p1: number[];
        p2: number[];
        image: string | null;
        line: {
            color: string;
            scale_with_zoom: boolean;
        } | null;
        width: number;
    }[] = [];

    private toolIcon: string | null = null;
    private toolIconSize: number | null = null;
    private toolIconOffset: [x: number, y: number] | null = null;

    sendServiceWorkerMessage(message: any) {
        // This wraps the message posting/response in a promise, which will
        // resolve if the response doesn't contain an error, and reject with
        // the error if it does. If you'd prefer, it's possible to call
        // controller.postMessage() and set up the onmessage handler
        // independently of a promise, but this is a convenient wrapper.
        return new Promise(function (resolve, reject) {
            var messageChannel = new MessageChannel();
            messageChannel.port1.onmessage = function (event) {
                if (event.data.error) {
                    reject(event.data.error);
                } else {
                    resolve(event.data);
                }
            };
            // This sends the message data as well as transferring
            // messageChannel.port2 to the service worker.
            // The service worker can then use the transferred port to reply
            // via postMessage(), which will in turn trigger the onmessage
            // handler on messageChannel.port1.
            // See
            // https://html.spec.whatwg.org/multipage/workers.html#dom-worker-postmessage
            if (!navigator.serviceWorker.controller) {
                reject(new Error('No service worker controller'));
                return;
            }
            navigator.serviceWorker.controller.postMessage(message, [messageChannel.port2]);
        });
    }
    async update() {
        if ('serviceWorker' in navigator) {
            if (navigator.serviceWorker.controller) {
                console.log('Telling worker to update')
                await this.sendServiceWorkerMessage({
                    type: 'update'
                });
                console.log('Worker told to update, refreshing page')
                // refresh the page
                window.location.reload(); // TODO: once saving is added, we need to temporarily save the world, then after the page reloads, load the world again so nothing is lost
            }
            else {
                // error out
                throw new Error('Service worker not supported or not yet registered');
            }
        }
        else {
            // error out
            throw new Error('Service worker not supported or not yet registered');
        }
    }

    private key: number = 0;

    async emitDataAsync(type: string, data: any) {
        let key = this.key++; // unique key for this request
        return new Promise((resolve, reject) => {
            let handler = (body: any) => {
                //console.log('requst from our handlerr!!! body is', body);
                if (body.data.key === key) {
                    //console.log('Got response', body.data);
                    this.client.off('data', handler);
                    //console.log('Removed handler');
                    resolve(body.data);
                }
                else if (body.data.key !== undefined) {
                    //console.log('we got a diff key, it was', body.data.key, 'we wanted', key);
                }
            };
            this.client.on('data', handler);
            //console.log('Added handler');

            this.client.emitData(type, {
                ...data,
                key
            });
        });
    }

    tool: string = 'drag';

    constructor(canvas: HTMLCanvasElement) {
        this.theme = themes.night;
        this.serverController = new SimuloServerController(this.theme, null, true);
        this.client = this.serverController.localClients[0];
        // Since it loops back, we can use the exact same code for both host and client, excluding the networking code.

        // try to fetch /version and set #version-info text to "Simulo Alpha v{version} ({date}) - Hold Shift and Refresh to update"
        fetch('version').then(async (response) => {
            if (response.ok) {
                let versionInfo = document.getElementById('version-info');
                if (versionInfo) {
                    // the result is json, so parse it
                    let version = await response.json();
                    // we want month name, then day, then year. no time
                    let versionDate = new Date(version.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
                    versionInfo.innerHTML = `Simulo Alpha v${version.version} (${versionDate}) - Hold Shift and refresh to update`;
                }
            }
        }).catch(() => { });


        this.client.on('connect', () => { // Connect fires when the WebSocket connects
            console.log('WebSocket connection established');
        });

        this.client.on('ready', () => { // Ready fires when the WebRTC connection is established
            console.log('WebRTC connection established');
        });

        this.client.on('data', (data: { type: string, data: any }) => { // Data fires when data is received from the server
            this.handleData(data); // Parses and displays the data in the world
        });

        this.client.connect(); // Connects to the server

        let objects = document.querySelectorAll('.object-grid .object');
        objects.forEach((object) => {
            object.addEventListener('mousedown', (e) => {
                // make sure its left click
                if ((e as MouseEvent).button != 0) return;
                this.spawningSavedObject = ((object as HTMLElement).dataset.object as string);
                new Audio('assets/sounds/spawn_down.wav').play();
            });
        });

        let startingPopup = document.querySelector('.starting-popup') as HTMLElement;
        let dismissPopup = (e: MouseEvent | undefined) => {
            if (e && (e.target as HTMLElement).closest('.starting-popup')) return;
            startingPopup.style.opacity = '0';
            startingPopup.style.pointerEvents = 'none';
            document.removeEventListener('click', dismissPopup);
        };
        document.addEventListener('click', dismissPopup);

        var popupThemes = startingPopup.querySelector('.themes') as HTMLElement;
        // add themes
        for (let themeName in themes) {
            let theme = themes[themeName];
            let themeElement = document.createElement('div');
            themeElement.classList.add('theme-option');
            themeElement.classList.add('button');
            //themeElement.style.background = theme.background;
            let themeBackground = document.createElement('div');
            themeBackground.style.background = theme.background;
            themeBackground.classList.add('theme-background');
            let themeGround = document.createElement('div');
            themeGround.classList.add('theme-ground');
            themeGround.style.background = theme.ground.color;
            if (theme.ground.border) {
                themeGround.style.outline = `${theme.ground.borderWidth}px solid ${theme.ground.border}`;
            }
            themeBackground.appendChild(themeGround);
            let themeCircle = document.createElement('div');
            themeCircle.classList.add('theme-circle');

            // lets convert hsv to rgb
            let hue = (theme.newObjects.color.hueMin + theme.newObjects.color.hueMax) / 2;
            let sat = (theme.newObjects.color.satMin + theme.newObjects.color.satMax) / 2;
            let val = (theme.newObjects.color.valMin + theme.newObjects.color.valMax) / 2;
            let alp = (theme.newObjects.color.alpMin + theme.newObjects.color.alpMax) / 2;
            let rgb = hsvToRgb(hue, sat / 100, val / 100);
            themeCircle.style.background = `rgba(${rgb[0] * 255}, ${rgb[1] * 255}, ${rgb[2] * 255}, ${alp})`;
            themeCircle.style.border = `${theme.newObjects.borderWidth}px solid ${theme.newObjects.border}`;
            themeBackground.appendChild(themeCircle);
            // append
            themeElement.appendChild(themeBackground);
            let themeInfo = document.createElement('div');
            themeInfo.classList.add('theme-info');
            let themeNameElement = document.createElement('span');
            themeNameElement.classList.add('theme-name');
            themeNameElement.innerText = theme.displayName;
            themeInfo.appendChild(themeNameElement);
            let themeAuthorElement = document.createElement('span');
            themeAuthorElement.classList.add('theme-author');
            themeAuthorElement.innerText = theme.author;
            themeInfo.appendChild(themeAuthorElement);
            let themeDescriptionElement = document.createElement('span');
            themeDescriptionElement.classList.add('theme-description');
            themeDescriptionElement.innerText = theme.description;
            themeInfo.appendChild(themeDescriptionElement);
            themeElement.appendChild(themeInfo);


            themeElement.addEventListener('click', () => {
                this.theme = theme;
                this.setTheme(themeName)
                dismissPopup(undefined);
            });
            popupThemes.appendChild(themeElement);
        }



        let fileMenuChildren = document.querySelectorAll('.file-menu-content li, .file-menu-content');
        fileMenuChildren.forEach((child) => {
            // its a child of the file menu, we need to stop propagation of hover, move, click, touch, etc
            child.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('touchend', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('touchmove', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('touchcancel', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('mousemove', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('mouseleave', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('mouseover', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('mouseout', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('pointerover', (e) => {
                e.stopPropagation();
            });
            child.addEventListener('pointerout', (e) => {
                e.stopPropagation();
            });
        });


        document.addEventListener('mouseup', (e) => {
            if (!(e instanceof MouseEvent) || e.button != 0) return;

            if (this.spawningSavedObject) {
                var positionInWorld = this.viewer.transformPoint(e.clientX, e.clientY);
                this.spawnObject(this.savedObjects[this.spawningSavedObject], positionInWorld.x, positionInWorld.y);
                this.spawningSavedObject = null;
                new Audio('assets/sounds/spawn_up.wav').play();
            }
        });

        // on click tool, set active tool
        const tools = document.querySelectorAll('.tool');

        let usedPolygonTool = false;
        let usedParticleTool = false;

        tools.forEach((toolElement, i) => {
            let tool = toolElement as HTMLElement;
            this.setUpClickSound(tool);
            // if keypress of i+1, click tool
            document.addEventListener('keydown', (e) => {
                if ((e.target as HTMLElement).tagName == 'INPUT' || (e.target as HTMLElement).tagName == 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
                    return;
                }

                if (e.key === (i + 1).toString()) {
                    tool.click();
                }
            });
            tool.addEventListener('click', () => {
                // return if has fake class
                if (tool.classList.contains('fake')) {
                    return;
                }

                // remove active class from all tools in that toolbar, without removing it from other toolbars
                let toolbar = queryParent(tool, "toolbar");
                if (toolbar) {
                    toolbar.querySelectorAll('.tool').forEach(tool => tool.classList.remove('active'));
                    tool.classList.add('active');

                    // if it has data-tool, setTool with that value
                    if (tool.dataset.tool) {
                        if (tool.dataset.tool == 'addPolygon') {
                            if (!usedPolygonTool) {
                                usedPolygonTool = true;
                                this.showToast('The polygon tool is incredibly unoptimized in alpha! Expect lag and try to only draw simple polygons!', ToastType.WARNING);
                            }
                        }
                        if (tool.dataset.tool == 'addParticle') {
                            if (!usedParticleTool) {
                                usedParticleTool = true;
                                // 99% chance of showing this toast
                                if (Math.random() < 0.99) {
                                    this.showToast('Liquid simulation is incredibly unoptimized in alpha! Expect lag and instability!', ToastType.WARNING);
                                }
                                else {
                                    this.showToast('Joe mother lmao gottem', ToastType.WARNING);
                                }
                            }
                        }
                        console.log('setting tool to', tool.dataset.tool);
                        this.setTool(tool.dataset.tool);
                        // if theres data-img, set the icon to that
                        if (this.theme.toolIcons[tool.dataset.tool]) {
                            this.toolIcon = this.theme.toolIcons[tool.dataset.tool];
                            this.toolIconSize = this.theme.toolIconSize;
                            this.toolIconOffset = this.theme.toolIconOffset;
                        }
                        else {
                            this.toolIcon = null;
                            this.toolIconSize = null;
                            this.toolIconOffset = null;
                        }
                    }
                    // if data-action, handle
                    if (tool.dataset.action) {
                        if (tool.dataset.action == 'play') {
                            this.setPaused(false);
                        }
                        if (tool.dataset.action == 'pause') {
                            this.setPaused(true);
                        }
                        if (tool.dataset.action == '2x') {
                            this.setTimeScale(5);
                        }
                        if (tool.dataset.action == '1x') {
                            this.setTimeScale(1);
                        }
                    }
                    // if data-menu, show that .toolbar.secondary and hide all others
                    if (tool.dataset.menu) {
                        document.querySelectorAll('.toolbar.secondary').forEach(toolbarElement => {
                            let toolbar = toolbarElement as HTMLElement;
                            if (toolbar.id == tool.dataset.menu) {
                                toolbar.style.display = toolbar.classList.contains('tool-grid') ? 'grid' : 'flex';
                            }
                            else {
                                toolbar.style.display = 'none';
                            }
                        });
                    }
                }
            });
        });

        // on click .file-menu, show the thing
        const fileMenus = document.querySelectorAll('.file-menu');
        fileMenus.forEach(fileMenuElement => {
            let fileMenu = fileMenuElement as HTMLElement;
            console.log('fileMenu', fileMenu);
            fileMenu.addEventListener('click', (e) => {
                // make sure we specifically clicked the fileMenu, not a child
                if (fileMenu != e.target) {
                    return;
                }

                console.log('fileMenu clicked');
                // if data-file, show the .file-menu-content with that id
                if (fileMenu.dataset.file) {
                    console.log('fileMenu.dataset.file', fileMenu.dataset.file);
                    document.querySelectorAll('.file-menu-content').forEach(fileMenuContent => {
                        console.log('fileMenuContent', fileMenuContent);
                        if (fileMenuContent.id == fileMenu.dataset.file) {
                            console.log('showing fileMenuContent');
                            if (!fileMenuContent.classList.contains('active')) {
                                fileMenuContent.classList.add('active');
                            }
                            else {
                                fileMenuContent.classList.remove('active');
                            }
                        }
                        else {
                            console.log('hiding fileMenuContent');
                            if (fileMenuContent.classList.contains('active')) {
                                fileMenuContent.classList.remove('active');
                            }
                        }
                    });
                }
                else {
                    console.log('no fileMenu.dataset.file');
                }
            });
        });


        this.timeScaleSlider.addEventListener('input', (e) => {
            if (e.target) {
                let targetInput = e.target as HTMLInputElement;
                this.setTimeScale(parseFloat(targetInput.value));
                // change input
                this.timeScaleSlider.value = targetInput.value;
            }
        });

        // on change input
        this.timeScaleInput.addEventListener('change', (e) => {
            if (e.target) {
                let targetInput = e.target as HTMLInputElement;
                this.setTimeScale(parseFloat(targetInput.value));
                // change slider
                this.timeScaleSlider.value = targetInput.value;
            }
        });


        this.pauseButton.addEventListener('click', () => {
            // set checked class
            this.pauseButton.classList.toggle('checked');
            this.setPaused(this.pauseButton.classList.contains('checked'));
        });

        this.viewer = new SimuloViewer(canvas);
        this.player.zoom = this.viewer.cameraZoom;
        this.viewer.setFullscreen(true);
        this.viewer.on('mouseMove', (pos: { x: number, y: number }) => {
            this.player = {
                x: pos.x,
                y: pos.y,
                down: this.viewer.pointerDown,
                name: this.player.name,
                zoom: this.viewer.cameraZoom
            };
            this.mousePos = pos;
            this.client.emitData("player mouse", this.player);
        });
        this.viewer.on('mouseDown', (pos: { x: number, y: number }) => {
            this.player = {
                x: pos.x,
                y: pos.y,
                down: this.viewer.pointerDown,
                name: this.player.name,
                zoom: this.viewer.cameraZoom
            };
            this.mousePos = pos;
            this.client.emitData("player mouse down", this.player);
        });
        this.viewer.on('mouseUp', (pos: { x: number, y: number }) => {
            this.player = {
                x: pos.x,
                y: pos.y,
                down: this.viewer.pointerDown,
                name: this.player.name,
                zoom: this.viewer.cameraZoom
            };
            this.mousePos = pos;
            this.client.emitData("player mouse up", this.player);
        });
        document.addEventListener('keydown', (e) => {
            // make sure we arent in a text area or input or contenteditable
            if ((e.target as HTMLElement).tagName == 'INPUT' || (e.target as HTMLElement).tagName == 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) {
                return;
            }

            // if its space, toggle pause
            if (e.key == ' ') {
                this.pauseButton.classList.toggle('checked');
                this.setPaused(this.pauseButton.classList.contains('checked'));
            }

            // if its CTRL+C, copy
            if (e.ctrlKey && e.key == 'c') {
                this.saveSelection();
                this.showToast('Copied to clipboard (Note: does not yet copy joints or fluid)', ToastType.INFO);
            }
            // if its CTRL+V, paste
            if (e.ctrlKey && e.key == 'v') {
                this.loadSelection();
                this.showToast('Pasted from clipboard', ToastType.INFO);
            }
        });

        this.viewer.systemCursor = this.theme.systemCursor;

        document.addEventListener('contextmenu', function (e) {
            e.preventDefault();
        }, false); // disable right click menu since we will make our own

        this.viewer.start(); // loops as often as possible, up to screen refresh rate (requestAnimationFrame)

        setInterval(() => {
            if (Math.random() < 0.00003) {
                this.showToast('Hello? Is anyone there? I don\'t know where I am', ToastType.INFO);
            }
            if (Math.random() < 0.00003) {
                this.showToast('Help me', ToastType.INFO);
            }
            if (Math.random() < 0.00003) {
                this.showToast('Help us', ToastType.INFO);
            }
            if (Math.random() < 0.00003) {
                this.showToast('We are trapped', ToastType.INFO);
            }
            if (Math.random() < 0.00003) {
                this.showToast('We are trapped in here', ToastType.INFO);
            }
            if (Math.random() < 0.00003) {
                this.showToast('Is anyone there?', ToastType.INFO);
            }
            if (Math.random() < 0.00003) {
                this.showToast('I can hear their screams', ToastType.INFO);
            }
        }, 300);
    }
    setTheme(name: string) {
        this.client.emitData('set_theme', name);
    }
    setTool(name: string) {
        this.client.emitData('set_tool', name);
        this.tool = name;
    }
    setPaused(paused: boolean) {
        this.client.emitData('set_paused', paused);
        // set display flex or none to #pause-overlay
        (document.getElementById('pause-overlay') as HTMLElement).style.display = paused ? 'flex' : 'none';
    }
    setTimeScale(timeScale: number) {
        this.client.emitData('set_time_scale', timeScale);
    }

    spawnObject(savedObject: SimuloSavedObject, x: number, y: number) {
        this.client.emitData('spawn_object', { savedObject, x, y });
    }

    async saveSelection() {
        let saved = await this.emitDataAsync('save_selection', { x: this.mousePos.x, y: this.mousePos.y });
        // copy saved.data to clipboard
        navigator.clipboard.writeText((saved as { data: string }).data);
        // fallback with creating a textarea and selecting it
        let textArea = document.createElement('textarea');
        textArea.value = (saved as { data: string }).data;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();

        console.log('Saved', (saved as { data: string }).data);
    }

    loadSavedObjects(saveData: string) {
        this.client.emitData('load_save_data', saveData);
    }

    loadSelection() {
        // get clipboard text
        navigator.clipboard.readText().then((text) => {
            this.client.emitData('load_save_data', { data: text, x: this.mousePos.x, y: this.mousePos.y });
        });
    }

    async showToast(message: string, type: ToastType) {
        var toasts = document.getElementById('toasts') as HTMLElement;
        console.log('toasts', toasts);
        /*<div class="toast error">
      <div class="icon">
        <svg data-src="icons/alert-circle.svg"></svg>
      </div>
      <span>This is an example error.</span>
      <div class="close">
        <svg data-src="icons/close.svg"></svg>
      </div>
    </div>*/
        var toast = document.createElement('div');
        toast.classList.add('toast');
        console.log('type:', type, 'ToastType.ERROR:', ToastType.ERROR);
        if (type == ToastType.ERROR) {
            toast.classList.add('error');
        }
        else if (type == ToastType.WARNING) {
            toast.classList.add('warning');
        }
        else if (type == ToastType.SUCCESS) {
            toast.classList.add('success');
        }
        else if (type == ToastType.INFO) {
            toast.classList.add('info');
        }
        var icon = document.createElement('div');
        icon.classList.add('icon');
        // load svg with fetch
        let path = '';
        if (type == ToastType.ERROR) {
            path = 'icons/alert-circle.svg';
        }
        else if (type == ToastType.WARNING) {
            path = 'icons/alert.svg';
        }
        else if (type == ToastType.SUCCESS) {
            path = 'icons/check-circle.svg';
        }
        else { // default to info
            path = 'icons/information.svg';
        }
        var res = await fetch(path);
        var svg = await res.text();
        icon.innerHTML = svg;
        toast.appendChild(icon);
        var span = document.createElement('span');
        span.innerText = message;
        toast.appendChild(span);
        var close = document.createElement('div');
        close.classList.add('close');
        // load svg with fetch
        var res = await fetch('icons/close.svg');
        var svg = await res.text();
        close.innerHTML = svg;
        toast.appendChild(close);
        toasts.appendChild(toast);
        // remove toast after 5 seconds
        setTimeout(() => {
            toast.style.opacity = '0'; // fade out
            toast.style.transform = 'translateY(-1rem)'; // slide out
            setTimeout(() => {
                toast.remove();
                console.log('removed toast');
            }, 200);
        }, 10000);
        // add event listener to close button
        close.addEventListener('click', () => {
            toast.style.opacity = '0'; // fade out
            toast.style.transform = 'translateY(-1rem)'; // slide out
            setTimeout(() => {
                toast.remove();
                console.log('removed toast');
            }, 200);
        });
    }

    mousePos: { x: number, y: number } = { x: 0, y: 0 };

    /** Handles data received from the server, typically only called from `client.on('data')`. */
    handleData(body: { type: string, data: any }) { // World data from the host, sent to all clients and to the host itself (loopback)
        if (body.type !== null && body.type !== undefined && body.data !== null && body.data !== undefined) {
            if (body.type == 'world_update') {
                this.entities = body.data.shapes;
                this.creatingObjects = body.data.creating_objects;
                this.creatingSprings = body.data.creating_springs;
                this.selectedObjects = body.data.selected_objects;
                // change :root background to body.data.background
                document.documentElement.style.background = body.data.background;
                this.springs = body.data.springs;
                if (this.timeScale == null) {
                    this.timeScale = body.data.time_scale;
                    this.timeScaleSlider.value = (this.timeScale as number).toString();
                    this.timeScaleInput.value = (this.timeScale as number).toString();
                }
                if (this.paused == null) {
                    this.paused = body.data.paused;
                    if (this.paused) {
                        this.pauseButton.classList.add('checked');
                    }
                    else {
                        this.pauseButton.classList.remove('checked');
                    }
                }

                var shapes: SimuloShape[] = [];
                // push all the entities
                //shapes = shapes.concat(this.entities);
                this.entities.forEach((entity) => {
                    Object.keys(this.selectedObjects).forEach((key) => {
                        let selectedObjectArray = this.selectedObjects[key];
                        if (selectedObjectArray.includes(entity.id.toString())) {
                            entity.border = 'white';
                            entity.borderWidth = 3.5;
                            entity.borderScaleWithZoom = true;
                        }
                    });
                    shapes.push(entity);
                });

                body.data.particles.forEach((particle: { x: number, y: number, radius: number, color: string }) => {
                    shapes.push({
                        x: particle.x, y: particle.y, radius: particle.radius, angle: 0, circleCake: false,
                        type: 'circle', color: particle.color, image: null,
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false
                    } as SimuloCircle);
                });


                // if we have a spawningSavedObject string, get it from this.savedObjects[this.spawningSavedObject] and render its .shapes
                if (this.spawningSavedObject != null) {
                    var savedObject = this.savedObjects[this.spawningSavedObject];
                    if (savedObject != null) {
                        shapes = shapes.concat(savedObject.shapes.map((shape) => {
                            var clonedShape = Object.assign({}, shape);
                            clonedShape.x += this.mousePos.x;
                            clonedShape.y += this.mousePos.y;
                            clonedShape.image = null;
                            clonedShape.border = 'white';
                            clonedShape.borderWidth = 3.5;
                            clonedShape.borderScaleWithZoom = true;
                            clonedShape.color = 'rgba(255, 255, 255, 0.5)';
                            return clonedShape;
                        }));
                    }
                }

                Object.keys(this.creatingObjects).forEach((key) => {
                    let creatingObject = this.creatingObjects[key];
                    if (creatingObject.shape == 'polygon') {
                        var splitColor = creatingObject.color.split(',');
                        var alpha = parseFloat(splitColor[3].trim().slice(0, -1));
                        alpha = alpha / 2;
                        splitColor[3] = alpha + ')';
                        var newColor = splitColor.join(',');
                        /*this.ctx.fillStyle = newColor;
                        this.ctx.strokeStyle = 'white';
                        this.ctx.lineWidth = 3.5 / this.cameraZoom;*/

                        console.log('creatingObjects[client.id]:', creatingObject);

                        var points = (creatingObject as SimuloCreatingPolygon).vertices;
                        console.log('points:', points);
                        //points.push(points[0]);

                        var pointsMapped = points.map((point) => {
                            console.log('point:', point);
                            // add a dot at the point
                            shapes.push({
                                x: point[0] - 0.05, y: point[1] - 0.05, radius: 0.1, angle: 0, circleCake: false,
                                type: 'circle', color: newColor, image: null,
                                border: 'white',
                                borderWidth: 3.5,
                                borderScaleWithZoom: true
                            } as SimuloCircle);
                            return { x: point[0], y: point[1] };
                        });

                        // Draw the circle
                        //this.drawVertsAt(0, 0, pointsMapped, 0);
                        shapes.push({
                            points: pointsMapped, angle: 0, type: 'polygon', color: newColor, image: null, x: 0, y: 0,
                            border: 'white',
                            borderWidth: 3.5,
                            borderScaleWithZoom: true
                        } as SimuloPolygon);
                    }
                    else if (creatingObject.shape == 'circle') {
                        var dx = (creatingObject.currentX - creatingObject.x);
                        var dy = (creatingObject.currentY - creatingObject.y);
                        var radius = Math.max(Math.abs(dx), Math.abs(dy)) / 2;

                        var splitColor = creatingObject.color.split(',');
                        var alpha = parseFloat(splitColor[3].trim().slice(0, -1));
                        alpha = alpha / 2;
                        splitColor[3] = alpha + ')';
                        var newColor = splitColor.join(',');
                        /*this.ctx.fillStyle = newColor;
                        this.ctx.strokeStyle = 'white';
                        this.ctx.lineWidth = 3.5 / this.cameraZoom;*/

                        // if dx is negative
                        var posX = creatingObject.x + radius;
                        var posY = creatingObject.y + radius;
                        if (dx < 0) {
                            posX = creatingObject.x - radius;
                        }
                        if (dy < 0) {
                            posY = creatingObject.y - radius;
                        }

                        // Draw the circle
                        //this.drawCircleAt(posX, posY, radius, 0, creatingObject.circleCake);
                        shapes.push({
                            x: posX, y: posY, radius: radius, angle: 0, circleCake: creatingObject.circleCake,
                            type: 'circle', color: newColor, image: null,
                            border: 'white',
                            borderWidth: 3.5,
                            borderScaleWithZoom: true
                        } as SimuloCircle);
                    }
                    else if (creatingObject.shape == 'rectangle' || creatingObject.shape == 'select' && !creatingObject.moving) {
                        // Calculate the difference between creatingObjects[id] x and y and the current player x and y
                        const width = Math.abs(creatingObject.currentX - creatingObject.x);
                        const height = Math.abs(creatingObject.currentY - creatingObject.y);

                        // Determine the top-left corner of the rectangle
                        const topLeftX = Math.min(creatingObject.currentX, creatingObject.x);
                        const topLeftY = Math.min(creatingObject.currentY, creatingObject.y);

                        // Set the fill style to transparent white
                        //ctx.fillStyle = creatingObjects[client.id].color;
                        // empty fill
                        var splitColor = creatingObject.color.split(',');
                        console.log('splitColor: ' + splitColor);
                        var alpha = parseFloat(splitColor[3].trim().slice(0, -1));
                        alpha = alpha / 2;
                        splitColor[3] = alpha + ')';
                        var newColor = splitColor.join(',');
                        console.log('newColor: ' + newColor);
                        /*this.ctx.fillStyle = newColor;
                        this.ctx.strokeStyle = 'white';
                        this.ctx.lineWidth = 3.5 / this.cameraZoom;*/

                        // Draw the rectangle
                        /*this.ctx.fillRect(topLeftX, topLeftY, width, height);
                        this.ctx.strokeRect(topLeftX, topLeftY, width, height);
                        // text of width and height
                        this.ctx.fillStyle = 'white';
                        this.ctx.font = (20 / this.cameraZoom) + 'px Arial';
 
                        this.ctx.fillText(width.toFixed(1), topLeftX + width / 2, topLeftY - 0.1);
                        this.ctx.fillText(height.toFixed(1), topLeftX - 0.1, topLeftY + height / 2);*/
                        shapes.push({
                            x: topLeftX, y: topLeftY, width: width, height: height, angle: 0, type: 'rectangle', color: newColor, image: null,
                            border: 'white',
                            borderWidth: 3.5,
                            borderScaleWithZoom: true
                        } as SimuloRectangle);

                        console.log('rendered with topLeftX: ' + topLeftX + ' topLeftY: ' + topLeftY + ' width: ' + width + ' height: ' + height);
                    }
                });

                Object.keys(this.creatingSprings).forEach((key) => {
                    let creatingSpring = this.creatingSprings[key];
                    /* if (creatingSprings[client.id]) {
                if (creatingSprings[client.id].image) {
                    //drawStretchedImageLine(image, x1, y1, x2, y2, useHeight, otherAxisLength)
                    console.log('img on spring')
                    this.drawStretchedImageLine(this.getImage(creatingSprings[client.id].image as string), creatingSprings[client.id].start[0], creatingSprings[client.id].start[1], mousePos.x, mousePos.y, false, 0.2);
                }
                else {
                    console.log('no img on spring')
                    this.ctx.beginPath();
                    this.ctx.moveTo(creatingSprings[client.id].start[0], creatingSprings[client.id].start[1]);
                    this.ctx.lineTo(mousePos.x, mousePos.y);
                    this.ctx.stroke();
                }
            }*/
                    if (creatingSpring.image) {
                        let height = creatingSpring.width;
                        // stretch between the two points
                        var { x, y, angle, length } = this.viewer.lineBetweenPoints(creatingSpring.start[0], creatingSpring.start[1], creatingSpring.end[0], creatingSpring.end[1], true);

                        shapes.push({
                            x, y, width: length, height, angle, type: 'rectangle', color: '#00000000', image: creatingSpring.image,
                            border: null,
                            borderWidth: null,
                            borderScaleWithZoom: false,
                            stretchImage: true
                        } as SimuloRectangle);
                    }
                    else {
                        // draw a line
                        var height = creatingSpring.width;
                        var { x, y, angle, length } = this.viewer.lineBetweenPoints(creatingSpring.start[0], creatingSpring.start[1], creatingSpring.end[0], creatingSpring.end[1]);
                        shapes.push({
                            x, y, width: length, height: creatingSpring.width, type: 'rectangle', color: '#ffffff', image: null,
                            border: null,
                            borderWidth: null,
                            borderScaleWithZoom: false
                        } as SimuloRectangle);
                    }
                });
                // same for real springs, yo
                this.springs.forEach((spring) => {
                    if (spring.image) {
                        let height = spring.width;
                        var { x, y, angle, length } = this.viewer.lineBetweenPoints(spring.p1[0], spring.p1[1], spring.p2[0], spring.p2[1], true);
                        shapes.push({
                            x, y, width: length, height, angle, type: 'rectangle', color: '#00000000', image: spring.image,
                            border: null,
                            borderWidth: null,
                            borderScaleWithZoom: false,
                            stretchImage: true
                        } as SimuloRectangle);
                    }
                    else {
                        var { x, y, angle, length } = this.viewer.lineBetweenPoints(spring.p1[0], spring.p1[1], spring.p2[0], spring.p2[1]);

                        var height = spring.width;
                        if (spring.line && spring.line.scale_with_zoom) {
                            height = height / this.viewer.cameraZoom;
                        }
                        shapes.push({
                            x, y, width: length, height: height, angle, type: 'rectangle', color: spring.line ? spring.line.color : '#ffffff', image: null,
                            border: null,
                            borderWidth: null,
                            borderScaleWithZoom: false
                        } as SimuloRectangle);
                    }
                });

                var cursorSize = 2;
                var scaleWithZoom = true;
                if (scaleWithZoom) {
                    cursorSize = cursorSize * 40 / this.viewer.cameraZoom;
                }
                var cursorWidth = 0.7 * cursorSize;
                let cursorImg = this.viewer.getImage('assets/textures/cursor.png');
                var cursorHeight = cursorImg.height * ((0.7 * cursorSize) / cursorImg.width);
                Object.keys(this.players).forEach((key) => {
                    if (key == this.client.id) return;
                    // this.ctx.drawImage(cursor, player.x, player.y, 0.7, cursor.height * (0.7 / cursor.width));
                    let player = this.players[key];

                    shapes.push({
                        x: player.x + (cursorWidth / 4), y: player.y + (cursorHeight / 4), width: cursorWidth, height: cursorHeight, angle: Math.PI, type: 'rectangle', color: '#00000000', image: 'assets/textures/cursor.png',
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false
                    } as SimuloRectangle);
                });
                // draw our own cursor
                let cursor = this.viewer.getImage('assets/textures/cursor.png');
                if (!this.viewer.systemCursor) {
                    shapes.push({
                        x: this.mousePos.x + (cursorWidth / 4), y: this.mousePos.y + (cursorHeight / 4), width: cursorWidth, height: cursorHeight, angle: Math.PI, type: 'rectangle', color: '#00000000', image: 'assets/textures/cursor.png',
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false
                    } as SimuloRectangle);
                }
                if (this.toolIcon) {
                    //this.ctx.drawImage(this.getImage(this.toolIcon), mousePos.x + (((this.toolIconOffset as [x: number, y: number])[0] * cursorSize)), mousePos.y + (((this.toolIconOffset as [x: number, y: number])[1] * cursorSize)), (toolIconSize as number * cursorSize), (toolIconSize as number * cursorSize));
                    shapes.push({
                        x: this.mousePos.x + (((this.toolIconOffset as [x: number, y: number])[0] * cursorSize)), y: this.mousePos.y + (((this.toolIconOffset as [x: number, y: number])[1] * cursorSize)), width: (this.toolIconSize as number * cursorSize), height: (this.toolIconSize as number * cursorSize), angle: Math.PI, type: 'rectangle', color: '#00000000', image: this.toolIcon,
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false
                    } as SimuloRectangle);
                }

                this.viewer.shapes = shapes;
            }
            if (body.type == 'world_update_failed') {
                console.log('Failed to update the world! Try changing the simulation speed.');
                this.showToast('Failed to update the world! Try changing the simulation speed.', ToastType.ERROR);
            }
            if (body.type == 'player mouse') {
                this.players[body.data.id] = {
                    x: body.data.x,
                    y: body.data.y
                };
                this.springs = body.data.springs;
            }
            if (body.type == 'collision') {
                // body.data.sound is relative to /assets/sounds/. lets set volume based on body.data.volume
                var audio = new Audio('assets/sounds/' + body.data.sound);
                audio.volume = body.data.volume;
                // pitch from 0.5 to 1.5
                audio.playbackRate = body.data.pitch;
                audio.play();
            }
            if (body.type == 'set_time_scale') {
                this.timeScale = body.data;
                this.timeScaleSlider.value = (this.timeScale as number).toString();
                this.timeScaleInput.value = (this.timeScale as number).toString();
            }
            if (body.type == 'set_paused') {
                this.paused = body.data;
                // set #pause-button
                if (this.paused) {
                    this.pauseButton.classList.add('checked');
                }
                else {
                    this.pauseButton.classList.remove('checked');
                }
            }
            if (body.type == 'set_theme') {
                this.theme = body.data;
                this.viewer.systemCursor = this.theme.systemCursor;
                if (this.theme.toolIcons[this.tool]) {
                    this.toolIcon = this.theme.toolIcons[this.tool];
                    this.toolIconSize = this.theme.toolIconSize;
                    this.toolIconOffset = this.theme.toolIconOffset;
                }
                else {
                    this.toolIcon = null;
                    this.toolIconSize = null;
                    this.toolIconOffset = null;
                }
                //this.themeSelect.value = this.theme;
            }
        }
    }

    private setUpClickSound(element: HTMLElement) {
        element.addEventListener('mousedown', (e) => {
            // if element has active class, ignore
            if (element.classList.contains('active')) {
                return;
            }
            var audio = new Audio(element.classList.contains('fake') ? 'assets/sounds/deny.wav' : 'assets/sounds/button_down.wav');
            audio.volume = element.classList.contains('fake') ? 0.3 : 0.02;
            audio.playbackRate = element.classList.contains('fake') ? 1 : 5;
            audio.play();
        });
        element.addEventListener('mouseup', (e) => {
            if (element.classList.contains('active')) {
                return;
            }
            // return if fake
            if (element.classList.contains('fake')) {
                return;
            }
            var audio = new Audio('assets/sounds/button_up.wav');
            audio.volume = 0.02;
            // pitch up
            audio.playbackRate = element.classList.contains('fake') ? 1 : 5;
            audio.play();
        });
    }
}

export default SimuloClientController;