import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"

fun main() {
    val master = scripts.wallet("master");
    println("Master wallet address: {}", master.address);

    if (net.isBroadcasting()) {
        println("Broadcasting transaction on Testnet...");
        val sendResult = net.send(master.address, createMessage({
            dest: master.address,
            value: ton("0.05"),
            bounce: false,
            body: "Init testnet wallet",
        }));
        println("Waiting for transaction confirmation...");
        val tx = sendResult.waitForFirstTransaction();
        if (tx != null) {
            println("Transaction confirmed! LT: {}", tx.lt);
        } else {
            println("Transaction submitted.");
        }
    } else {
        println("Emulation mode");
    }
}
