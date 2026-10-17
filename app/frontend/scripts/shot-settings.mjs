import puppeteer from 'puppeteer-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
const out = path.join(os.tmpdir(), 'downvid-shots'); fs.mkdirSync(out,{recursive:true})
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox','--hide-scrollbars','--force-device-scale-factor=2']})
const p = await b.newPage()
await p.setViewport({width:1280,height:900,deviceScaleFactor:2})
await p.goto(process.argv[2],{waitUntil:'networkidle0'}).catch(()=>{})
await new Promise(r=>setTimeout(r,900))
await p.screenshot({path:path.join(out,'home.png')})
await p.evaluate(()=>[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('设置'))?.click())
await new Promise(r=>setTimeout(r,600))
await p.evaluate(()=>[...document.querySelectorAll('.settings-nav button')].find(e=>/加速/.test(e.textContent))?.click())
await new Promise(r=>setTimeout(r,600))
await p.screenshot({path:path.join(out,'settings-accel.png')})
console.log(path.join(out,'settings-accel.png'))
await b.close()
