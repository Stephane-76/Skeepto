//=============================================================================
// SkWebInterface.mjs
// Web interface for SkServer
// Author Stéphane ALLEZ 08/08/2024
//=============================================================================
import { writeSync } from "fs";
import { LocalStorage } from "node-localstorage";
import fetch, { FormData, File, fileFrom } from 'node-fetch';

// Helper function to safely get localStorage values or provide defaults
function getLocalStorageValue(key, defaultValue = '') {
  try {
    if (typeof global !== 'undefined' && global.localStorage) {
      return global.localStorage.getItem(key) || defaultValue;
    }
    return defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

export class SkWebInterface {
  constructor(sWebHttpAdr) {
    this.m_WebHttpAdr = sWebHttpAdr;
    this.m_AuthToken = "";
    this.m_UserEmail = "";
  }

  // Method to set authentication token
  setAuthToken(email, token) {
    this.m_AuthToken = token;
    this.m_UserEmail = email;
  }

  Error(sMessage ) {
    console.error(sMessage);
  }

  getJson = async (sUri,sJsonQuery) => {
    let wOptions = {
      method: 'GET',
      mode : 'cors',
      credentials: 'include',
      headers : {
        authorization : 'Bearer '+getLocalStorageValue("jwt", this.m_AuthToken),
      },
      user : getLocalStorageValue("user"),
    }
    sUri=this.m_WebHttpAdr+sUri
    if (sJsonQuery!=undefined) sUri=sUri+'/'+sJsonQuery
    console.log('[GET] URL:', sUri)
    try {
      const response = await fetch(sUri,wOptions);
      if (!response.ok) {
        return({ message: 'error', error: `Response status: ${response.status}` });
      }
    
      const wJson = await response.text();
      //console.log(wJson);
      return(wJson)
    } catch (error) {
      console.error(error.message);
    }
  }


  postJson = async (sUri, sJsonBody, sMode='insert') => {
    let wOptions = {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: {
        'X-Operation-Mode': sMode,
        'Content-Type': 'application/json',
        authorization: 'Bearer ' + getLocalStorageValue("jwt", this.m_AuthToken),
      },
      user: getLocalStorageValue("user"),
      body: typeof sJsonBody === 'string' ? sJsonBody : JSON.stringify(sJsonBody)
    }

    // Add the web http address to the uri
    sUri = this.m_WebHttpAdr + sUri;
    try {
      console.log('Sending POST request to:', sUri);
      const bodyPreview = wOptions.body.length > 80 ? 
        wOptions.body.substring(0, 80) + '...' : 
        wOptions.body;
      console.log('Request body:', bodyPreview);
      
      const response = await fetch(sUri, wOptions);
      if (!response.ok) {
        return { message: 'error', error: `Response status: ${response.status}` };
      }
    
      const wObj = await response.json();
      console.log('Response received:', wObj);
      return wObj;
    } catch (error) {
      console.error('Error in PostJson:', error);
      return { message: 'error', error: error.message };
    }
  }

  deleteJson = async (sUri,sJsonQuery) => {
    let wOptions = {
      method: 'DELETE',
      mode : 'cors',
      credentials: 'include',
      headers: {
        authorization : 'Bearer '+getLocalStorageValue("jwt", this.m_AuthToken),
        'Content-Type': 'application/json'
      },
      user : getLocalStorageValue("user"),
    }
    sUri=this.m_WebHttpAdr+sUri

    if (sJsonQuery!=undefined) sUri=sUri+'/'+encodeURIComponent(sJsonQuery);
    try {
      const wResponse = await fetch(sUri,wOptions);
      if (!wResponse.ok) {
        return({ message: 'error', error: `Response status: ${wResponse.status}` });
      }
    
      const wResponseJson = await wResponse.json()
      let wResponseJsonString=JSON.stringify(wResponseJson)
      return(wResponseJsonString)
    } catch (error) {
      return({ message: 'error', error: error.message });
    }
  }
}

export default SkWebInterface;