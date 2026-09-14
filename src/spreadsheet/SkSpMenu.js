import React from "react";
import SkComponent from "../component/SkComponent";
import SkMenuElement from "../component/SkMenuElement";
import { LogMessage } from "../component/SkLogMessage.js";

class SkSpMenu extends SkComponent {
    constructor(props) {
        super(props);
        this.m_SpInterface=props.SpInterface;
        console.log( "SkSpMenu::constructor");
        this.state = ({ });
        this.m_Menu=[];
        this.LoadMenu();
    }

    LoadMenu() {
        this.m_Menu=[];
        let wJson= window.SkUISpreadSheet.JsonMenu();
        const  wObjMenu=JSON.parse(wJson);
        let wIndex = 0;

        while (wIndex < wObjMenu.menu.length) {
            console.log( wObjMenu.menu[wIndex]);
            this.m_Menu.push(wObjMenu.menu[wIndex]);
            wIndex++;
        }
    }

    onSelect(event,id) {
        console.log( id);
        this.m_SpInterface.onSelect(event,id);
    }
// ... rest of the code ...
} 