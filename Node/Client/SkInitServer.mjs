//=============================================================================
// SkInitServer.mjs
//=============================================================================

import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const envRoot = resolve(__dirname, '../../.env')
const envLocal = resolve(__dirname, '../Server/.env')
const envPath = existsSync(envRoot) ? envRoot : envLocal
if (existsSync(envPath)) {
  // dotenv is installed under Node/Server
  require('../Server/node_modules/dotenv').config({ path: envPath })
  console.log('Loaded environment from', envPath)
}

//=============================================================================
// Import
//=============================================================================
import { LocalStorage } from "node-localstorage"
import { SkWebInterface }  from "./SkWebInterface.mjs"
import { SkLogin } from "./SkClientLogin.mjs"
import { SkFillVirtualDisk } from "./SkFillVitualDisk.mjs"
import { fillData } from './SkFillData.mjs';


// for Logging ================================
function delay(milliseconds){
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
  }

  async function  InitMetamodel(wSkWebInterface) {
     // Load the meta model on the server
     const wResultLoadMetaModel=await  wSkWebInterface.getJson("/meta/json")
     console.log('/load/metamodel/Json:',wResultLoadMetaModel)
     //let wMetaModelTempo=JSON.parse(wResultLoadMetaModel)
     //let wMetaModel=JSON.parse(wMetaModelTempo.metamodel)
     //console.log(wMetaModel)
 
     // Write the meta model on the server
     const wResultMetaModel=await wSkWebInterface.getJson('/meta/write')
     console.log('/write/metamodel:'+wResultMetaModel)
 
  }
//=============================================================================
// Main
//=============================================================================

global.localStorage = new LocalStorage('./scratch')

console.log("SkInitServer Version 1.0")
// Use 127.0.0.1 — on Linux, localhost often resolves to ::1 while SkServer listens on IPv4.
let wHttpAdr = process.env.SKER_SERVER_URL || 'http://127.0.0.1:8000'


try {
    let wSkWebInterface=new SkWebInterface(wHttpAdr)
    const wResultStart=await wSkWebInterface.getJson('/')
    console.log('/start:',wResultStart)
    const wAdminEmail = process.env.SKER_ADMIN_EMAIL || 'admin@sker.com';
    const wAdminPassword = process.env.SKER_ADMIN_PASSWORD || 'Il fait beau a rouen';
    await SkLogin(wHttpAdr, wAdminEmail, wAdminPassword); 
    await delay(1000);

    let wUser={
        "user":"admin@sker.com",
        "group":"admin"
    }
    global.localStorage.setItem("user", JSON.stringify(wUser));
    // Init Metamodel ==========================================================
    await InitMetamodel(wSkWebInterface);
   
    // Fill Data
    await fillData(wSkWebInterface);

    // Fill Virtual Disk
    const wFillVirtualDisk=new SkFillVirtualDisk(wSkWebInterface)
    await wFillVirtualDisk.Fill();

    // Loop on all users
    //let wSqlQuery="{\"select\":\"SELECT * FROM User WHERE Name LIKE 'A%' OR Name LIKE '%B' ORDER BY Name DESC, FirstName DESC\"}"
    let wSqlQuery="{\"select\":\"SELECT * FROM User  ORDER BY Name ASC, FirstName ASC\"}"
    let wGetSQLReturn=await wSkWebInterface.postJson('/sql',wSqlQuery)
    console.log("SQL Query------------------------")
    for (let wUser of wGetSQLReturn.records) {
        if (wUser.Name !== "#ADMIN")  {
            console.log('user:',wUser)
            await SkLogin(wHttpAdr,wUser.Email,wUser.Password);
            delay(1000);
            global.localStorage.setItem("user", JSON.stringify(wUser));
            wFillVirtualDisk.setOwner(wUser.Email);
            wFillVirtualDisk.setGroup(wUser.Group);
            console.log('fill virtual disk for user:', wUser.Email);
            await wFillVirtualDisk.fillVirtualDiskForUser(wUser.Email);
        }
    }

} catch (err) {
    console.log("Error SkInitServer=",err);
}