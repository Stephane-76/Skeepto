//=============================================================================
// SkItem
// Items for SpreadSheet 
//=============================================================================
class tCell {
	constructor(sCol,sRow) {
		this.m_Col=sCol;
		this.m_Row=sRow;
	}
	assign(sCell) {
		this.m_Col=sCell.m_Col;
		this.m_Row=sCell.m_Row;
  }
}

class tRange extends tCell {
	constructor(sLeft,sTop,sRight,sBottom) {
    super(sLeft,sTop);
		this.m_Right=sRight;
		this.m_Bottom=sBottom;
	}
	assign(sRange) {
		this.m_Col=sRange.m_Col;
		this.m_Row=sRange.m_Row;
 		this.m_Right=sRange.m_Right;
		this.m_Bottom=sRange.m_Bottom;		
	}
	
	normalize() {
		if (this.m_Col>this.m_Right) { var wTmp=this.m_Right; this.m_Right=this.m_Col; this.m_Col=wTmp; }
		if (this.m_Row>this.m_Bottom) { var wTmp=this.m_Bottom; this.m_Bottom=this.m_Row; this.m_Row=wTmp; }
	}

	getWidth() {
		return(this.m_Right-this.m_Col);
	}

	getHeight() {
		return(this.m_Bottom-this.m_Row);
	}

	}

  class tSelect {
     constructor() {
        this.m_Anchor = tCell(1,1);
     }
  }
