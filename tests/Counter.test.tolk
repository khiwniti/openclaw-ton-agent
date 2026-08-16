import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@contracts/Counter"
import "@wrappers/Counter.gen"

fun setupCounter(): (Counter, Treasury) {
    val deployer = testing.treasury("deployer");
    val counter = Counter.fromStorage({ counter: 0 });
    val deployment = counter.deploy(deployer.address, { value: ton("1") });
    expect(deployment).toHaveSuccessfulDeploy({ to: counter.address });
    return (counter, deployer);
}

get fun `test counter starts at zero`() {
    val (counter, _) = setupCounter();
    expect(counter.getCounter()).toEqual(0);
}

get fun `test increment persists decoded message`() {
    val (counter, deployer) = setupCounter();
    val increment = counter.sendIncrement(deployer.address, 1, 5, { value: ton("0.05") });
    expect(increment).toHaveSuccessfulTx({ to: counter.address });
    expect(counter.getCounter()).toEqual(5);
}