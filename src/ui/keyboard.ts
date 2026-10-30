import { useEffect, useState } from "react";
import { Dimensions, Keyboard } from "react-native";

/**
 * How much of the screen the keyboard covers. With edge-to-edge, Android no
 * longer resizes the window, and the reported height leaves out the gesture
 * bar, so measure from the keyboard's top edge.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(Math.max(0, Dimensions.get("screen").height - e.endCoordinates.screenY)));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
