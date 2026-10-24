package com.sseanssalm.keel;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before the bridge inflates the WebView, so Android 15 edge-to-edge
        // insets reach the CSS safe-area variables instead of covering the ledger.
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
