import React from 'react';

/**
 * Copies text to the clipboard and spawns a floating '已复制 ✓' tooltip near the mouse cursor.
 * @param text The string content to copy.
 * @param e The mouse event to determine coordinates.
 */
export const copyToClipboard = (text: string, e: React.MouseEvent | MouseEvent) => {
  navigator.clipboard.writeText(text).then(() => {
    // Get mouse coordinates
    const x = e.clientX;
    const y = e.clientY;

    // Create tooltip element
    const tip = document.createElement('div');
    
    // Style coordinates and micro-animations
    tip.className = 'fixed z-[9999] px-2.5 py-1 text-[11px] text-white bg-slate-900/95 dark:bg-primary/95 rounded-lg shadow-xl pointer-events-none transform -translate-x-1/2 -translate-y-full transition-all duration-300 opacity-0 scale-75 font-sans font-medium border border-white/10';
    tip.style.left = `${x}px`;
    tip.style.top = `${y - 12}px`;
    tip.innerText = '已复制 ✓';
    document.body.appendChild(tip);

    // Force layout engine reflow to trigger animation
    tip.offsetHeight;

    // Animate in
    tip.style.opacity = '1';
    tip.style.transform = 'translate(-50%, -100%) scale(1)';

    // Animate out and cleanup
    setTimeout(() => {
      tip.style.opacity = '0';
      tip.style.transform = 'translate(-50%, -120%) scale(0.85)';
      setTimeout(() => {
        if (tip.parentNode) {
          document.body.removeChild(tip);
        }
      }, 300);
    }, 1000);
  }).catch((err) => {
    console.error('Failed to copy text: ', err);
  });
};
