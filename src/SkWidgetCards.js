import * as React  from "react";

import { SkComponent } from './component/SkComponent'
import { SkWidgetCard } from './SkWidgetCard'

export class SkWidgetCards extends SkComponent {
  constructor(props) {
    super(props)
 
    this.setState( {   
      recordList : [],
      selectedCardIndex: -1,  // Index of selected card
    });
  
    this.m_WidgetName=props.widgetname
    this.m_TableName=props.tablename
    this.m_Form = null
    this.m_Table = null
    this.m_OnRecordSelect=props.onRecordSelect;
    this.getWidget()
    this.loadTable()
    // Keep track of card references
    this.CardRefs = [];
  }

 async getWidget() {
    // Load Model =============================================================
    let wResultStr=await window.WebInterface.getJson("/meta/widget/"+this.m_WidgetName+"_Card")   
    let wResult=JSON.parse(wResultStr)

    if (wResult.message==="success") {
      this.m_Form=wResult.object
      this.setState( { Validate : false })
      this.loadData();
    }
 }

 async loadTable() {
    // Load Data ==============================================================
    let wResultStr=await window.WebInterface.getJson("/meta/table/"+this.m_TableName)   
    let wResult=JSON.parse(wResultStr)

    if (wResult.message==="success") {
      this.m_Table=wResult.object
      this.setState( { Validate : false })
      this.loadData();
    }
 }

 async loadData() {
    // Load Data ==============================================================
    //let wSqlQuery="{\"select\":\"SELECT * FROM User WHERE Name LIKE 'A%' OR Name LIKE '%B' ORDER BY Name ASC, FirstName ASC\"}"
    //let wSqlQuery="{\"select\":\"SELECT * FROM User ORDER BY Name ASC, FirstName ASC\"}"
    let wSqlQuery="{\"select\":\"SELECT * FROM "+this.m_TableName+"\"}"
    let wResult=await window.WebInterface.postJson('/sql',wSqlQuery)
    let wObjResult=JSON.parse(wResult)
    if (wObjResult.message==='success') {
      this.setState( { recordList : wObjResult.records })
    }
    console.log('Get Card ----->',wResult)
  }

  // Create a ref for each input
  setCardRef = (wIndex) => (element) => {
    this.CardRefs[wIndex] = element;
  };


  RenderCard(sRecord,sIndex) {
    let wClassName="";
    if (this.m_Form.hasOwnProperty('m_StyleWidget'))
      wClassName=this.m_Form.m_StyleWidget

    if (sIndex===this.state.selectedCardIndex) { 
      wClassName+=" SkCard-selected"
    }
    
    return(
        <SkWidgetCard className={wClassName} 
                      widget={this.m_Form} 
                      record={sRecord}
                      key={sIndex}
                      index={sIndex}
                      onCardSelect={this.handleCardClick}
                      onKeyDown={this.handleKeyDown}
                      ref={this.setCardRef(sIndex)}
                      />
      ) 
  }

  RenderResult() {
    return(
      this.state.recordList!==undefined && this.state.recordList.length!==0 ?
      // Loop on record
      this.state.recordList.map((wRecord,wIndex) => (
        this.RenderCard(wRecord,wIndex) 
        ))
      :
        <h1>No data</h1>
    )
  }
  
  keyUp(sIndex) {
    let wCard=this.CardRefs[sIndex];
    let wRect=wCard.m_Ref.current.getBoundingClientRect();
    let wX=wRect.x;
    
    while(sIndex>0) {
      sIndex--;
      let wCardRef=this.CardRefs[sIndex];
      let wRectRef=wCardRef.m_Ref.current.getBoundingClientRect();
      if (wX>=wRectRef.x && wX<=wRectRef.x+wRectRef.width) {
        return(sIndex);
      }
    }
    return(0);
  }

  keyDown(sIndex) {
    let wCard=this.CardRefs[sIndex];
    let wRect=wCard.m_Ref.current.getBoundingClientRect();
    let wX=wRect.x;
    while(sIndex<this.CardRefs.length-1) {
      sIndex++;
      let wCardRef=this.CardRefs[sIndex];
      let wRectRef=wCardRef.m_Ref.current.getBoundingClientRect();
      if (wX>=wRectRef.x && wX<=wRectRef.x+wRectRef.width) {
        return(sIndex);
      }
    } 
    return(sIndex);
  }

  handleKeyDown = (event) => {
    const  cards  = this.state.recordList;
    const { selectedCardIndex } = this.state;
    
    if (selectedCardIndex === -1 && cards.length > 0) {
      this.setState({ selectedCardIndex: 0 });
      return;
    }

    switch(event.key) {
      case 'ArrowRight':
        event.preventDefault();
        // Select the next card
        const wIndexRight=Math.min(selectedCardIndex + 1, cards.length - 1)    
        this.setState(
          { selectedCardIndex: wIndexRight },  // First argument: the new state
          () => {                         // Second argument: the callback
              this.scrollSelectedCardIntoView();
              if (this.m_OnRecordSelect) {
                  this.m_OnRecordSelect(this.state.recordList[wIndexRight]);
              }
          }
        );
        break;

      case 'ArrowLeft':
        event.preventDefault();
        // Select the previous card
        const wIndexLeft = Math.max(selectedCardIndex - 1, 0);
        this.setState(
            { selectedCardIndex: wIndexLeft },  // First argument: the new state
            () => {                         // Second argument: the callback
                this.scrollSelectedCardIntoView();
                if (this.m_OnRecordSelect) {
                    this.m_OnRecordSelect(this.state.recordList[wIndexLeft]);
                }
            }
        );
        break;

      case 'ArrowDown':
        event.preventDefault();
        // Select the card below
        const nextRowIndex = this.keyDown(selectedCardIndex);
        if (nextRowIndex < cards.length) {
          this.setState({ selectedCardIndex: nextRowIndex }, () => {
            this.scrollSelectedCardIntoView();
            if (this.props.onCardSelect) {
                this.props.onCardSelect(cards[nextRowIndex]);
            }
            if (this.m_OnRecordSelect) {
              this.m_OnRecordSelect(this.state.recordList[this.state.selectedCardIndex]);
            }
       
        });
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        // Select the card above
        const prevRowIndex =  this.KeyUp(selectedCardIndex);
        if (prevRowIndex >= 0) {
          this.setState({ selectedCardIndex: prevRowIndex }, () => {
            this.scrollSelectedCardIntoView();
            if (this.props.onCardSelect) {
                this.props.onCardSelect(cards[prevRowIndex]);
            }
            if (this.m_OnRecordSelect) {
              this.m_OnRecordSelect(cards[prevRowIndex]);
            }
        });
        }
        break;

      case 'Enter':
      case ' ': // Space
        event.preventDefault();
        if (selectedCardIndex >= 0 && this.props.onCardSelect) {
          this.props.onCardSelect(cards[selectedCardIndex]);
        }
        break;

      default:
        break;
    }

    // Scroll the selected card into view if needed
    this.scrollSelectedCardIntoView();
  };

  scrollSelectedCardIntoView = () => {
    const selectedCard = document.querySelector('.SkCard-selected');
    if (selectedCard) {
      selectedCard.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  };

  handleCardClick = (index) => {
    this.setState({ selectedCardIndex: index }, () => {
      if (this.props.onCardSelect) {
        this.props.onCardSelect(this.state.recordList[index]);
      }
      if (this.m_OnRecordSelect) {
        this.m_OnRecordSelect(this.state.recordList[index]);
      }
    });
  };

   
  componentDidMount() {
  }

  componentDidUpdate() {
  }

  componentWillUnmount() {
   }
 
  render() {
    if (this.m_Form===null) return(<h1>"Load</h1>)
    let wClassName=this.m_Form.m_Style
    
    return (      
    <div className={wClassName} ref={this.m_Ref} onKeyDown={this.handleKeyDown} tabIndex="0"   style={{
      height: '400px',  // or the height you want
      maxHeight: '100%'
      }}>
      { this.RenderResult() }
    </div>
    )
  }
}
// ========================================

export default SkWidgetCards;