import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/scripts"
import "@contracts/Counter"
import "@wrappers/Counter.gen"

fun main() {
    val deployer = scripts.wallet("master");
    println("Deployer address: {}", deployer.address);

    if (net.isBroadcasting()) {
        println("Running on real network");
    } else {
        println("Running in emulation mode");
    }

    val counter = Counter.fromStorage({ counter: 0 });
    println("Target contract address: {}", counter.address);
}