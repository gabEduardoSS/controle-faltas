import osUtils from 'os-utils';


const POLL_INTERVAL = 2000;

export function pollResources(){
    setInterval(() => {
        getResUsage();
    }, POLL_INTERVAL);
}

function getResUsage() {
    var memory: string = `${(osUtils.freememPercentage()).toFixed(2)}%`;
    osUtils.cpuUsage((usage) => {
        var cpu: string = `${(usage * 100).toFixed(2)}%`;
        console.log(`CPU Usage: ${cpu}, Memory Usage: ${memory}`);
    });

}