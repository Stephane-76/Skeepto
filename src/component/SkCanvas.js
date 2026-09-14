//=============================================================================
// SkCanvas
// Anscestor Canvas (for drawing with invalidate)
//=============================================================================
import SkComponent  from "./SkComponent";

class SkCanvas extends SkComponent {
  constructor(props) {
    super(props);
    this.m_SpInterface=props.SpInterface;
  }

  invalidate() {
    this.paint();
  }

  componentDidMount(prevProps) {
    // Store bound event handler to properly remove it later
    this.boundResize = this.resize.bind(this);
    window.addEventListener('resize', this.boundResize);
    this.invalidate();
  }

  componentDidUpdate(prevProps) {
    this.invalidate();
  }

  /**
   * Clean up all resources when component unmounts to prevent memory leaks
   * - Removes resize event listener
   */
  componentWillUnmount(prevProps) {
    window.removeEventListener('resize', this.boundResize);
  }

  resize() {
    this.invalidate();
  }

}
// ============================================================================
export default SkCanvas;